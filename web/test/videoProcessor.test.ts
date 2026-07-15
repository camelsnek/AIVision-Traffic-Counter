import { afterEach, describe, expect, it, vi } from 'vitest'

import { VideoProcessor } from '../src/services/videoProcessor'
import type { DetectorResult } from '../src/services/vehicleDetector'
import type { AnalysisConfig } from '../src/types'

class FakeCanvas {
  width = 640
  height = 360
  readonly draws: unknown[][] = []
  readonly clears: unknown[][] = []

  private readonly context = {
    drawImage: (...args: unknown[]) => this.draws.push(args),
    clearRect: (...args: unknown[]) => this.clears.push(args),
  }

  getContext() {
    return this.context
  }
}

class FakeVideo extends EventTarget {
  readonly duration = 0.4
  readonly videoWidth = 1920
  readonly videoHeight = 1080
  readonly log: string[] = []
  onSeek: ((value: number) => void) | null = null
  private time = 0

  get currentTime() {
    return this.time
  }

  set currentTime(value: number) {
    this.time = value
    this.log.push(`seek:${value.toFixed(4)}`)
    this.onSeek?.(value)
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')))
  }

  pause() {}
}

const config: AnalysisConfig = {
  modelProfileId: 'onnx-community/yolov10n',
  enginePreference: 'cpu',
  preprocessingProfileId: 'standard-v1',
  confidence: 0.35,
  samplingFps: 5,
  zones: [
    {
      id: 'zone-1',
      label: 'Zone 1',
      region: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
      lineOrientation: 'horizontal',
      lineOffset: 0.5,
    },
  ],
}

const emptyResult: DetectorResult = {
  detections: [],
  timings: {
    captureMs: 1,
    preprocessingMs: 0,
    tensorMs: 2,
    inferenceMs: 3,
    postprocessMs: 1,
    totalMs: 7,
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VideoProcessor seek pipeline', () => {
  it('prefetches the next timestamp during detection while publishing ordered committed frames', async () => {
    const presentationCanvas = new FakeCanvas()
    const displayCanvas = new FakeCanvas()
    vi.stubGlobal('document', { createElement: () => presentationCanvas })
    vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: () => undefined })

    const video = new FakeVideo()
    const log = video.log
    const detectionStarts = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
    const detectionResults = Array.from({ length: 3 }, () => Promise.withResolvers<DetectorResult>())
    let detectionIndex = 0
    const detector = {
      prepare(source: CanvasImageSource, frameWidth: number, frameHeight: number) {
        const index = detectionIndex++
        const sampleTime = (source as unknown as FakeVideo).currentTime
        expect([frameWidth, frameHeight]).toEqual([1920, 1080])
        log.push(`prepare:${sampleTime.toFixed(4)}`)
        return {
          infer() {
            log.push(`infer-start:${sampleTime.toFixed(4)}`)
            detectionStarts[index].resolve()
            return detectionResults[index].promise.then((result) => {
              log.push(`infer-end:${sampleTime.toFixed(4)}`)
              return result
            })
          },
          dispose() {},
        }
      },
    }
    const frames: { videoTime: number; seekMs: number; frameIntervalMs: number }[] = []
    let endReason: string | null = null

    const processor = new VideoProcessor(
      video as unknown as HTMLVideoElement,
      displayCanvas as unknown as HTMLCanvasElement,
      detector,
      config,
      {
        onFrame: (update) => {
          log.push(`frame:${update.videoTime.toFixed(4)}`)
          frames.push({
            videoTime: update.videoTime,
            seekMs: update.timings.seekMs,
            frameIntervalMs: update.timings.frameIntervalMs,
          })
        },
        onDone: (reason) => {
          endReason = reason
        },
        onError: (error) => {
          throw error
        },
      },
    )

    const run = processor.run()
    await detectionStarts[0].promise
    expect(log).toContain('seek:0.2000')
    detectionResults[0].resolve(emptyResult)
    await detectionStarts[1].promise
    expect(log).toContain('seek:0.4000')
    detectionResults[1].resolve(emptyResult)
    await detectionStarts[2].promise
    detectionResults[2].resolve(emptyResult)
    await run

    expect(endReason).toBe('complete')
    expect(frames.map((frame) => frame.videoTime)).toEqual([0.0001, 0.2, 0.4])
    expect(frames[0].frameIntervalMs).toBe(0)
    expect(frames.slice(1).every((frame) => frame.seekMs >= 0 && frame.frameIntervalMs > 0)).toBe(true)
    expect(log.indexOf('seek:0.2000')).toBeLessThan(log.indexOf('infer-end:0.0001'))
    expect(log.indexOf('frame:0.0001')).toBeLessThan(log.indexOf('infer-start:0.2000'))
    expect(log.indexOf('seek:0.4000')).toBeLessThan(log.indexOf('infer-end:0.2000'))
    expect(displayCanvas.draws).toHaveLength(3)
    expect(presentationCanvas.draws).toHaveLength(3)
  })

  it('queues immutable decoded frames while preserving sequential detector calls and timestamps', async () => {
    const presentationCanvas = new FakeCanvas()
    const displayCanvas = new FakeCanvas()
    let nowMs = 0
    vi.stubGlobal('document', { createElement: () => presentationCanvas })
    vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: () => undefined })
    vi.stubGlobal('performance', { now: () => nowMs })

    const video = new FakeVideo()
    const thirdSeekStarted = Promise.withResolvers<void>()
    video.onSeek = (value) => {
      if (Math.abs(value - 0.4) < 1e-6) {
        thirdSeekStarted.resolve()
      }
    }

    const capturedFrames: FakeVideoFrame[] = []
    class FakeVideoFrame {
      readonly sampleTime: number
      closed = false

      constructor(source: FakeVideo) {
        this.sampleTime = source.currentTime
        capturedFrames.push(this)
      }

      close() {
        this.closed = true
      }
    }
    vi.stubGlobal('VideoFrame', FakeVideoFrame)

    const preparationStarts = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
    const detectionStarts = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
    const detectionResults = Array.from({ length: 3 }, () => Promise.withResolvers<DetectorResult>())
    const preparationTimes: number[] = []
    const inferenceTimes: number[] = []
    let detectionIndex = 0
    const detector = {
      prepare(source: CanvasImageSource, frameWidth: number, frameHeight: number) {
        const index = detectionIndex++
        const sampleTime = (source as unknown as FakeVideoFrame).sampleTime
        expect([frameWidth, frameHeight]).toEqual([1920, 1080])
        preparationTimes.push(sampleTime)
        preparationStarts[index].resolve()
        return {
          infer() {
            inferenceTimes.push(sampleTime)
            detectionStarts[index].resolve()
            return detectionResults[index].promise
          },
          dispose() {},
        }
      },
    }
    const publishedTimes: number[] = []
    const presentationStates: boolean[] = []

    const processor = new VideoProcessor(
      video as unknown as HTMLVideoElement,
      displayCanvas as unknown as HTMLCanvasElement,
      detector,
      config,
      {
        onFrame: (update) => {
          publishedTimes.push(update.videoTime)
          presentationStates.push(update.presented)
        },
        onDone: () => undefined,
        onError: (error) => {
          throw error
        },
      },
    )

    const run = processor.run()
    await detectionStarts[0].promise
    await thirdSeekStarted.promise
    expect(preparationTimes).toEqual([0.0001, 0.2])
    expect(inferenceTimes).toEqual([0.0001])

    nowMs = 1
    detectionResults[0].resolve(emptyResult)
    await detectionStarts[1].promise
    await preparationStarts[2].promise
    expect(preparationTimes).toEqual([0.0001, 0.2, 0.4])
    expect(inferenceTimes).toEqual([0.0001, 0.2])
    nowMs = 10
    detectionResults[1].resolve(emptyResult)
    await detectionStarts[2].promise
    nowMs = 20
    detectionResults[2].resolve(emptyResult)
    await run

    expect(inferenceTimes).toEqual([0.0001, 0.2, 0.4])
    expect(publishedTimes).toEqual([0.0001, 0.2, 0.4])
    expect(presentationStates).toEqual([true, false, true])
    expect(displayCanvas.draws).toHaveLength(2)
    expect(presentationCanvas.draws).toHaveLength(2)
    expect(capturedFrames).toHaveLength(4)
    expect(capturedFrames.every((frame) => frame.closed)).toBe(true)
    expect(displayCanvas.clears).toHaveLength(0)
  })

  it('pauses after the active sample and resumes at the next timestamp', async () => {
    const presentationCanvas = new FakeCanvas()
    const displayCanvas = new FakeCanvas()
    vi.stubGlobal('document', { createElement: () => presentationCanvas })
    vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: () => undefined })

    const video = new FakeVideo()
    const detectionStarts = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
    const detectionResults = Array.from({ length: 3 }, () => Promise.withResolvers<DetectorResult>())
    let detectionIndex = 0
    const detector = {
      prepare() {
        const index = detectionIndex++
        return {
          infer() {
            detectionStarts[index].resolve()
            return detectionResults[index].promise
          },
          dispose() {},
        }
      },
    }
    const publishedTimes: number[] = []
    let endReason: string | null = null
    const processor = new VideoProcessor(
      video as unknown as HTMLVideoElement,
      displayCanvas as unknown as HTMLCanvasElement,
      detector,
      config,
      {
        onFrame: (update) => publishedTimes.push(update.videoTime),
        onDone: (reason) => {
          endReason = reason
        },
        onError: (error) => {
          throw error
        },
      },
    )

    const run = processor.run()
    await detectionStarts[0].promise
    expect(processor.pause()).toBe(true)
    expect(processor.pause()).toBe(false)

    detectionResults[0].resolve(emptyResult)
    await Promise.resolve()
    await Promise.resolve()
    expect(publishedTimes).toEqual([0.0001])
    expect(detectionIndex).toBe(1)

    expect(processor.resume()).toBe(true)
    expect(processor.resume()).toBe(false)
    await detectionStarts[1].promise
    detectionResults[1].resolve(emptyResult)
    await detectionStarts[2].promise
    detectionResults[2].resolve(emptyResult)
    await run

    expect(endReason).toBe('complete')
    expect(publishedTimes).toEqual([0.0001, 0.2, 0.4])
  })

  it('releases a prepared look-ahead frame when stopped during active inference', async () => {
    const presentationCanvas = new FakeCanvas()
    const displayCanvas = new FakeCanvas()
    vi.stubGlobal('document', { createElement: () => presentationCanvas })
    vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: () => undefined })

    const video = new FakeVideo()
    const capturedFrames: Array<{ closed: boolean }> = []
    class FakeVideoFrame {
      closed = false

      constructor() {
        capturedFrames.push(this)
      }

      close() {
        this.closed = true
      }
    }
    vi.stubGlobal('VideoFrame', FakeVideoFrame)

    const activeInference = Promise.withResolvers<DetectorResult>()
    const lookAheadPrepared = Promise.withResolvers<void>()
    const disposeLookAhead = vi.fn()
    let preparationIndex = 0
    const detector = {
      prepare() {
        const index = preparationIndex++
        if (index === 1) {
          lookAheadPrepared.resolve()
        }
        return {
          infer() {
            if (index !== 0) {
              return Promise.reject(new Error('Look-ahead inference must not start after stop.'))
            }
            return activeInference.promise
          },
          dispose() {
            if (index === 1) {
              disposeLookAhead()
            }
          },
        }
      },
    }
    const publishedTimes: number[] = []
    let endReason: string | null = null
    const processor = new VideoProcessor(
      video as unknown as HTMLVideoElement,
      displayCanvas as unknown as HTMLCanvasElement,
      detector,
      config,
      {
        onFrame: (update) => publishedTimes.push(update.videoTime),
        onDone: (reason) => {
          endReason = reason
        },
        onError: (error) => {
          throw error
        },
      },
    )

    const run = processor.run()
    await lookAheadPrepared.promise
    processor.stop()
    activeInference.resolve(emptyResult)
    await run

    expect(endReason).toBe('stopped')
    expect(publishedTimes).toEqual([0.0001])
    expect(disposeLookAhead).toHaveBeenCalledOnce()
    expect(capturedFrames.every((frame) => frame.closed)).toBe(true)
  })

})
