import { TrafficCounter } from '../lib/trafficCounter'
import { clampRect, padRect, rectUnion } from '../lib/geometry'
import type { AnalysisConfig, CountEvent, RectNorm, TrackSnapshot } from '../types'
import type { DetectorResult, DetectorTimings } from './vehicleDetector'

export interface DetectorRunner {
  detect(
    video: HTMLVideoElement,
    roi: RectNorm,
    minConfidence: number,
    preprocessingProfileId: AnalysisConfig['preprocessingProfileId'],
  ): Promise<DetectorResult>
}

export interface FrameTimings {
  /** Seek/decode wall time for this sample; later seeks may overlap the previous detector call. */
  seekMs: number
  /** Copy of the analyzed frame into the reusable presentation buffer. */
  frameCaptureMs: number
  detector: DetectorTimings
  counterMs: number
  /** Copy from the presentation buffer to the visible frame canvas. */
  displayMs: number
  /** Completion-to-completion wall interval, including overlapped work. */
  frameIntervalMs: number
}

export interface FrameUpdate {
  videoTime: number
  durationSeconds: number
  /** 0..1 share of the video processed so far. */
  progress: number
  tracks: TrackSnapshot[]
  newEvents: CountEvent[]
  timings: FrameTimings
  /** Analyzed frames per wall-clock second, smoothed. */
  throughputFps: number
}

export type ProcessorEndReason = 'complete' | 'stopped'

export interface ProcessorHooks {
  onFrame(update: FrameUpdate): void
  onDone(reason: ProcessorEndReason): void
  onError(error: Error): void
}

/** Padding added around the union of zones for the detector's ROI crop. */
const ROI_PADDING = 0.04
/** If the padded zone union covers most of the frame, analyze the full frame. */
const FULL_FRAME_COVERAGE = 0.82
const SEEK_TIMEOUT_MS = 8000

/**
 * Deterministic offline analysis: steps through the video by seeking fixed
 * video-time increments, running detection and counting on every step.
 *
 * Results depend only on the video and the config — never on machine speed.
 * The display canvas receives the exact captured frame paired with each
 * overlay update, even while the hidden video element seeks ahead.
 */
export class VideoProcessor {
  private readonly video: HTMLVideoElement
  private readonly displayCanvas: HTMLCanvasElement
  private readonly detector: DetectorRunner
  private readonly config: AnalysisConfig
  private readonly hooks: ProcessorHooks
  private readonly counter: TrafficCounter
  private readonly roi: RectNorm
  private readonly presentationCanvas = document.createElement('canvas')
  private stopped = false
  private running = false

  constructor(
    video: HTMLVideoElement,
    displayCanvas: HTMLCanvasElement,
    detector: DetectorRunner,
    config: AnalysisConfig,
    hooks: ProcessorHooks,
  ) {
    this.video = video
    this.displayCanvas = displayCanvas
    this.detector = detector
    this.config = config
    this.hooks = hooks
    this.counter = new TrafficCounter(config.zones)
    this.roi = resolveRegionOfInterest(config.zones.map((zone) => zone.region))
  }

  /** Begins processing from the start of the video. Resolves when done. */
  async run(): Promise<void> {
    if (this.running) {
      throw new Error('Processor is already running.')
    }
    this.running = true

    const stepSeconds = 1 / this.config.samplingFps
    const duration = this.video.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      this.running = false
      this.hooks.onError(new Error('The video duration could not be determined.'))
      return
    }

    this.video.pause()
    let throughputFps = 0
    let lastWallTime = performance.now()
    let pendingSeek = startTimedSeek(this.video, 0)

    try {
      for (let time = 0; time <= duration && !this.stopped; time += stepSeconds) {
        const seek = await pendingSeek
        if (seek.error) {
          throw seek.error
        }
        if (this.stopped) {
          break
        }

        const sampleVideoTime = this.video.currentTime
        const frameCaptureMs = this.capturePresentationFrame()

        // detect() synchronously captures its ROI before returning a promise.
        // The same video can therefore start decoding the next timestamp while
        // the processor and ONNX runtime work on immutable current-frame pixels.
        const detectionPromise = this.detector.detect(
          this.video,
          this.roi,
          this.config.confidence,
          this.config.preprocessingProfileId,
        )

        const nextTime = time + stepSeconds
        const nextSeek =
          nextTime <= duration && !this.stopped
            ? startTimedSeek(this.video, Math.min(nextTime, duration))
            : null

        const detectorResult = await detectionPromise
        const counterStart = performance.now()
        const { tracks, events } = this.counter.update(detectorResult.detections, sampleVideoTime)
        const counterMs = performance.now() - counterStart
        const displayMs = this.presentFrame()

        const now = performance.now()
        const frameIntervalMs = Math.max(1, now - lastWallTime)
        const instantFps = 1000 / frameIntervalMs
        throughputFps = throughputFps === 0 ? instantFps : throughputFps * 0.85 + instantFps * 0.15
        lastWallTime = now

        this.hooks.onFrame({
          videoTime: sampleVideoTime,
          durationSeconds: duration,
          progress: Math.min(1, time / duration),
          tracks,
          newEvents: events,
          timings: {
            seekMs: seek.ms,
            frameCaptureMs,
            detector: detectorResult.timings,
            counterMs,
            displayMs,
            frameIntervalMs,
          },
          throughputFps,
        })

        pendingSeek = nextSeek ?? Promise.resolve({ ms: 0, error: null })
      }

      this.hooks.onDone(this.stopped ? 'stopped' : 'complete')
    } catch (error) {
      this.hooks.onError(error instanceof Error ? error : new Error('Video analysis failed.'))
    } finally {
      this.running = false
    }
  }

  /** Requests a stop; the loop exits at the next step boundary. */
  stop() {
    this.stopped = true
  }

  private capturePresentationFrame(): number {
    const startedAt = performance.now()
    const width = this.displayCanvas.width || this.video.videoWidth
    const height = this.displayCanvas.height || this.video.videoHeight
    if (this.presentationCanvas.width !== width) {
      this.presentationCanvas.width = width
    }
    if (this.presentationCanvas.height !== height) {
      this.presentationCanvas.height = height
    }
    const context = this.presentationCanvas.getContext('2d')
    if (!context) {
      throw new Error('Unable to capture the analyzed video frame.')
    }
    context.drawImage(this.video, 0, 0, width, height)
    return performance.now() - startedAt
  }

  private presentFrame(): number {
    const startedAt = performance.now()
    const context = this.displayCanvas.getContext('2d')
    if (!context) {
      throw new Error('Unable to display the analyzed video frame.')
    }
    context.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height)
    context.drawImage(this.presentationCanvas, 0, 0)
    return performance.now() - startedAt
  }
}

interface SeekOutcome {
  ms: number
  error: Error | null
}

function startTimedSeek(video: HTMLVideoElement, time: number): Promise<SeekOutcome> {
  const startedAt = performance.now()
  return seekTo(video, time).then(
    () => ({ ms: performance.now() - startedAt, error: null }),
    (error: unknown) => ({
      ms: performance.now() - startedAt,
      error: error instanceof Error ? error : new Error('Video seeking failed.'),
    }),
  )
}

function resolveRegionOfInterest(regions: readonly RectNorm[]): RectNorm {
  const padded = clampRect(padRect(rectUnion(regions), ROI_PADDING))
  if (padded.width * padded.height >= FULL_FRAME_COVERAGE) {
    return { left: 0, top: 0, width: 1, height: 1 }
  }
  return padded
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  // Seeking to the exact current position may not fire 'seeked' in all
  // browsers; nudge the target by a sub-frame amount instead of skipping,
  // so every step yields a real event.
  const target = Math.abs(video.currentTime - time) < 1e-6 ? time + 1e-4 : time

  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const timeoutId = window.setTimeout(() => {
    cleanup()
    reject(new Error('Timed out while seeking the video. The file may be corrupt or unsupported.'))
  }, SEEK_TIMEOUT_MS)

  const handleSeeked = () => {
    cleanup()
    resolve()
  }
  const handleError = () => {
    cleanup()
    reject(new Error('The browser could not decode this video.'))
  }
  const cleanup = () => {
    window.clearTimeout(timeoutId)
    video.removeEventListener('seeked', handleSeeked)
    video.removeEventListener('error', handleError)
  }

  video.addEventListener('seeked', handleSeeked)
  video.addEventListener('error', handleError)
  video.currentTime = target

  return promise
}
