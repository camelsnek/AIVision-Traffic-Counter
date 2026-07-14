import { TrafficCounter } from '../lib/trafficCounter'
import { clampRect, padRect, rectUnion } from '../lib/geometry'
import type { AnalysisConfig, CountEvent, RectNorm, TrackSnapshot } from '../types'
import type { VehicleDetector } from './vehicleDetector'

export interface FrameUpdate {
  videoTime: number
  durationSeconds: number
  /** 0..1 share of the video processed so far. */
  progress: number
  tracks: TrackSnapshot[]
  newEvents: CountEvent[]
  /** Latest model inference latency, ms. */
  inferenceMs: number
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
 * The video element always displays the exact frame being analyzed, so the
 * overlay is always in sync.
 */
export class VideoProcessor {
  private readonly video: HTMLVideoElement
  private readonly detector: VehicleDetector
  private readonly config: AnalysisConfig
  private readonly hooks: ProcessorHooks
  private readonly counter: TrafficCounter
  private readonly roi: RectNorm
  private stopped = false
  private running = false

  constructor(video: HTMLVideoElement, detector: VehicleDetector, config: AnalysisConfig, hooks: ProcessorHooks) {
    this.video = video
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
      this.hooks.onError(new Error('The video duration could not be determined.'))
      return
    }

    this.video.pause()
    let throughputFps = 0
    let lastWallTime = performance.now()

    try {
      for (let time = 0; time <= duration && !this.stopped; time += stepSeconds) {
        await seekTo(this.video, Math.min(time, duration))
        if (this.stopped) {
          break
        }

        const inferenceStart = performance.now()
        const detections = await this.detector.detect(
          this.video,
          this.roi,
          this.config.confidence,
          this.config.preprocessingProfileId,
        )
        const inferenceMs = performance.now() - inferenceStart
        const { tracks, events } = this.counter.update(detections, this.video.currentTime)

        const now = performance.now()
        const instantFps = 1000 / Math.max(1, now - lastWallTime)
        throughputFps = throughputFps === 0 ? instantFps : throughputFps * 0.85 + instantFps * 0.15
        lastWallTime = now

        this.hooks.onFrame({
          videoTime: this.video.currentTime,
          durationSeconds: duration,
          progress: Math.min(1, time / duration),
          tracks,
          newEvents: events,
          inferenceMs,
          throughputFps,
        })
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
