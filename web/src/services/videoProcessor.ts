import { TrafficCounter } from '../lib/trafficCounter'
import { clampRect, padRect, rectUnion } from '../lib/geometry'
import { RollingCompletionRate } from '../lib/rollingCompletionRate'
import type { AnalysisConfig, CountEvent, RectNorm, TrackSnapshot } from '../types'
import type { DetectorResult, DetectorTimings, PreparedDetectorFrame } from './vehicleDetector'

export interface DetectorRunner {
  prepare(
    source: CanvasImageSource,
    frameWidth: number,
    frameHeight: number,
    roi: RectNorm,
    minConfidence: number,
    preprocessingProfileId: AnalysisConfig['preprocessingProfileId'],
  ): PreparedDetectorFrame
}

export interface FrameTimings {
  /** Seek/decode wall time for this sample; immutable frames permit bounded look-ahead. */
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
  /** Whether this completion published a matching frame and overlay update. */
  presented: boolean
  tracks: TrackSnapshot[]
  newEvents: CountEvent[]
  timings: FrameTimings
  /** Rolling rate over up to 16 completed analyzed frames. */
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
const MIN_PRESENTATION_INTERVAL_MS = 50

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
  private readonly displayContext: CanvasRenderingContext2D
  private readonly detector: DetectorRunner
  private readonly config: AnalysisConfig
  private readonly hooks: ProcessorHooks
  private readonly counter: TrafficCounter
  private readonly roi: RectNorm
  private readonly presentationCanvas = document.createElement('canvas')
  private readonly presentationContext: CanvasRenderingContext2D
  private snapshotQueue: FrameSampleQueue | null = null
  private lastPresentationAt: number | null = null
  private stopped = false
  private running = false
  private paused = false
  private resumeWaiters: Array<() => void> = []

  constructor(
    video: HTMLVideoElement,
    displayCanvas: HTMLCanvasElement,
    detector: DetectorRunner,
    config: AnalysisConfig,
    hooks: ProcessorHooks,
  ) {
    const displayContext = displayCanvas.getContext('2d')
    const presentationContext = this.presentationCanvas.getContext('2d')
    if (!displayContext || !presentationContext) {
      throw new Error('Unable to prepare frame canvases for video analysis.')
    }

    this.video = video
    this.displayCanvas = displayCanvas
    this.displayContext = displayContext
    this.detector = detector
    this.config = config
    this.hooks = hooks
    this.counter = new TrafficCounter(config.zones)
    this.roi = resolveRegionOfInterest(config.zones.map((zone) => zone.region))
    this.presentationContext = presentationContext
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
    try {
      if (supportsImmutableVideoFrames(this.video)) {
        await this.runSnapshotPipeline(duration, stepSeconds)
      } else {
        await this.runLiveVideoPipeline(duration, stepSeconds)
      }
      this.hooks.onDone(this.stopped ? 'stopped' : 'complete')
    } catch (error) {
      this.hooks.onError(error instanceof Error ? error : new Error('Video analysis failed.'))
    } finally {
      this.snapshotQueue?.cancel()
      this.snapshotQueue = null
      this.running = false
    }
  }

  /** Pauses before the next detector call while preserving the current session. */
  pause(): boolean {
    if (!this.running || this.stopped || this.paused) {
      return false
    }
    this.paused = true
    return true
  }

  /** Resumes a paused processor from its next prepared video timestamp. */
  resume(): boolean {
    if (!this.running || this.stopped || !this.paused) {
      return false
    }
    this.paused = false
    this.releaseResumeWaiters()
    return true
  }

  /** Requests a stop and releases any decoded frames waiting in the queue. */
  stop() {
    this.stopped = true
    this.snapshotQueue?.cancel()
    this.paused = false
    this.releaseResumeWaiters()
  }

  /**
   * Immutable snapshots let preparation for N+1 overlap inference for N.
   * Inference, tracking, counting, and publication still commit strictly in
   * source-timestamp order.
   */
  private async runSnapshotPipeline(duration: number, stepSeconds: number): Promise<void> {
    const queue = new FrameSampleQueue(2)
    const completionRate = new RollingCompletionRate()
    this.snapshotQueue = queue
    const producer = this.produceSnapshotFrames(queue, duration, stepSeconds)
    let current: PreparedFrameSample | null = null

    try {
      current = await this.takePreparedSnapshot(queue)
      while (current) {
        await this.waitUntilResumed()
        if (this.stopped) {
          break
        }
        const active = current
        current = null
        const inference = active.prepared.infer()
        let next: PreparedFrameSample | null = null
        let preparationError: unknown = null

        if (!this.stopped) {
          try {
            next = await this.takePreparedSnapshot(queue)
          } catch (error) {
            preparationError = error
          }
        }

        try {
          const detectorResult = await inference
          this.commitFrame(
            active.sample,
            detectorResult,
            duration,
            completionRate,
            active.sample.source,
          )
        } catch (error) {
          releasePreparedFrame(next)
          throw error
        } finally {
          active.sample.source.close()
        }

        if (preparationError) {
          releasePreparedFrame(next)
          throw preparationError
        }
        if (this.stopped) {
          releasePreparedFrame(next)
          break
        }
        current = next
      }
      if (this.stopped) {
        queue.cancel()
      }
      await producer
    } catch (error) {
      releasePreparedFrame(current)
      queue.cancel()
      await producer
      throw error
    } finally {
      releasePreparedFrame(current)
      queue.cancel()
      if (this.snapshotQueue === queue) {
        this.snapshotQueue = null
      }
    }
  }

  private async produceSnapshotFrames(
    queue: FrameSampleQueue,
    duration: number,
    stepSeconds: number,
  ): Promise<void> {
    try {
      for (let time = 0; time <= duration && !this.stopped; time += stepSeconds) {
        await this.waitUntilResumed()
        if (this.stopped) {
          break
        }
        if (!(await queue.waitForSpace()) || this.stopped) {
          break
        }
        const seek = await startTimedSeek(this.video, Math.min(time, duration))
        if (seek.error) {
          throw seek.error
        }
        if (this.stopped) {
          break
        }

        const source = new VideoFrame(this.video)
        queue.push({
          source,
          targetTime: time,
          finalSample: time + stepSeconds > duration,
          videoTime: seek.videoTime,
          frameWidth: this.video.videoWidth,
          frameHeight: this.video.videoHeight,
          seekMs: seek.ms,
        })
      }
      queue.finish()
    } catch (error) {
      queue.finish(error instanceof Error ? error : new Error('Video frame preparation failed.'))
    }
  }

  private async takePreparedSnapshot(
    queue: FrameSampleQueue,
  ): Promise<PreparedFrameSample | null> {
    const sample = await queue.take()
    if (!sample) {
      return null
    }

    try {
      return {
        sample,
        prepared: this.detector.prepare(
          sample.source,
          sample.frameWidth,
          sample.frameHeight,
          this.roi,
          this.config.confidence,
          this.config.preprocessingProfileId,
        ),
      }
    } catch (error) {
      sample.source.close()
      throw error
    }
  }

  /** Compatibility path for browsers that cannot snapshot a decoded frame. */
  private async runLiveVideoPipeline(duration: number, stepSeconds: number): Promise<void> {
    const completionRate = new RollingCompletionRate()
    let pendingSeek = startTimedSeek(this.video, 0)

    for (let time = 0; time <= duration && !this.stopped; time += stepSeconds) {
      await this.waitUntilResumed()
      if (this.stopped) {
        break
      }
      const seek = await pendingSeek
      if (seek.error) {
        throw seek.error
      }
      if (this.stopped) {
        break
      }

      const sample: FrameSampleMetadata = {
        targetTime: time,
        finalSample: time + stepSeconds > duration,
        videoTime: this.video.currentTime,
        frameWidth: this.video.videoWidth,
        frameHeight: this.video.videoHeight,
        seekMs: seek.ms,
      }
      const frameCaptureMs = this.capturePresentationFrame(this.video)
      const prepared = this.detector.prepare(
        this.video,
        sample.frameWidth,
        sample.frameHeight,
        this.roi,
        this.config.confidence,
        this.config.preprocessingProfileId,
      )
      const detectionPromise = prepared.infer()

      const nextTime = time + stepSeconds
      const nextSeek =
        nextTime <= duration && !this.stopped
          ? startTimedSeek(this.video, Math.min(nextTime, duration))
          : null

      const detectorResult = await detectionPromise
      this.commitFrame(sample, detectorResult, duration, completionRate, null, frameCaptureMs)
      pendingSeek =
        nextSeek ?? Promise.resolve({ ms: 0, error: null, videoTime: this.video.currentTime })
    }
  }

  private commitFrame(
    sample: FrameSampleMetadata,
    detectorResult: DetectorResult,
    duration: number,
    completionRate: RollingCompletionRate,
    presentationSource: CanvasImageSource | null,
    capturedFrameMs = 0,
  ) {
    const counterStart = performance.now()
    const { tracks, events } = this.counter.update(detectorResult.detections, sample.videoTime)
    const counterMs = performance.now() - counterStart
    const shouldPresent =
      presentationSource === null || this.shouldPresent(sample, events, performance.now())
    const frameCaptureMs =
      shouldPresent && presentationSource ? this.capturePresentationFrame(presentationSource) : capturedFrameMs
    const displayMs = shouldPresent ? this.presentFrame() : 0
    if (shouldPresent) {
      this.lastPresentationAt = performance.now()
    }
    const completion = completionRate.record(performance.now())

    this.hooks.onFrame({
      videoTime: sample.videoTime,
      durationSeconds: duration,
      progress: Math.min(1, sample.targetTime / duration),
      presented: shouldPresent,
      tracks,
      newEvents: events,
      timings: {
        seekMs: sample.seekMs,
        frameCaptureMs,
        detector: detectorResult.timings,
        counterMs,
        displayMs,
        frameIntervalMs: completion.intervalMs,
      },
      throughputFps: completion.ratePerSecond,
    })
  }

  private shouldPresent(
    sample: FrameSampleMetadata,
    events: readonly CountEvent[],
    now: number,
  ): boolean {
    return (
      this.lastPresentationAt === null ||
      events.length > 0 ||
      sample.finalSample ||
      now - this.lastPresentationAt >= MIN_PRESENTATION_INTERVAL_MS
    )
  }

  private capturePresentationFrame(source: CanvasImageSource): number {
    const startedAt = performance.now()
    const width = this.displayCanvas.width || this.video.videoWidth
    const height = this.displayCanvas.height || this.video.videoHeight
    if (this.presentationCanvas.width !== width) {
      this.presentationCanvas.width = width
    }
    if (this.presentationCanvas.height !== height) {
      this.presentationCanvas.height = height
    }
    this.presentationContext.drawImage(source, 0, 0, width, height)
    return performance.now() - startedAt
  }

  private presentFrame(): number {
    const startedAt = performance.now()
    this.displayContext.drawImage(this.presentationCanvas, 0, 0)
    return performance.now() - startedAt
  }
  private async waitUntilResumed(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve)
      })
    }
  }

  private releaseResumeWaiters() {
    for (const resolve of this.resumeWaiters.splice(0)) {
      resolve()
    }
  }

}

interface FrameSampleMetadata {
  targetTime: number
  finalSample: boolean
  videoTime: number
  frameWidth: number
  frameHeight: number
  seekMs: number
}

interface FrameSample extends FrameSampleMetadata {
  source: VideoFrame
}

interface PreparedFrameSample {
  readonly sample: FrameSample
  readonly prepared: PreparedDetectorFrame
}

function releasePreparedFrame(frame: PreparedFrameSample | null) {
  if (!frame) {
    return
  }
  frame.prepared.dispose()
  frame.sample.source.close()
}

class FrameSampleQueue {
  private readonly items: FrameSample[] = []
  private readonly capacity: number
  private closed = false
  private error: Error | null = null
  private itemWaiter: (() => void) | null = null
  private spaceWaiter: (() => void) | null = null

  constructor(capacity: number) {
    this.capacity = capacity
  }

  async waitForSpace(): Promise<boolean> {
    while (!this.closed && this.items.length >= this.capacity) {
      await new Promise<void>((resolve) => {
        this.spaceWaiter = resolve
      })
    }
    return !this.closed
  }

  push(sample: FrameSample) {
    if (this.closed || this.items.length >= this.capacity) {
      sample.source.close()
      throw new Error('Decoded frame queue rejected a frame.')
    }
    this.items.push(sample)
    this.itemWaiter?.()
    this.itemWaiter = null
  }

  async take(): Promise<FrameSample | null> {
    while (this.items.length === 0 && !this.closed) {
      await new Promise<void>((resolve) => {
        this.itemWaiter = resolve
      })
    }
    const sample = this.items.shift()
    if (sample) {
      this.spaceWaiter?.()
      this.spaceWaiter = null
      return sample
    }
    if (this.error) {
      throw this.error
    }
    return null
  }

  finish(error: Error | null = null) {
    this.closed = true
    this.error = error
    this.itemWaiter?.()
    this.itemWaiter = null
    this.spaceWaiter?.()
    this.spaceWaiter = null
  }

  cancel() {
    this.closed = true
    for (const sample of this.items) {
      sample.source.close()
    }
    this.items.length = 0
    this.itemWaiter?.()
    this.itemWaiter = null
    this.spaceWaiter?.()
    this.spaceWaiter = null
  }
}

function supportsImmutableVideoFrames(video: HTMLVideoElement): boolean {
  if (typeof VideoFrame !== 'function') {
    return false
  }
  try {
    const frame = new VideoFrame(video)
    frame.close()
    return true
  } catch {
    return false
  }
}

interface SeekOutcome {
  ms: number
  error: Error | null
  videoTime: number
}

function startTimedSeek(video: HTMLVideoElement, time: number): Promise<SeekOutcome> {
  const startedAt = performance.now()
  return seekTo(video, time).then(
    () => ({ ms: performance.now() - startedAt, error: null, videoTime: video.currentTime }),
    (error: unknown) => ({
      ms: performance.now() - startedAt,
      error: error instanceof Error ? error : new Error('Video seeking failed.'),
      videoTime: video.currentTime,
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
