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
  private time = 0

  get currentTime() {
    return this.time
  }

  set currentTime(value: number) {
    this.time = value
    this.log.push(`seek:${value.toFixed(4)}`)
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
      detect(source: HTMLVideoElement) {
        const index = detectionIndex++
        const sampleTime = source.currentTime
        log.push(`detect-start:${sampleTime.toFixed(4)}`)
        detectionStarts[index].resolve()
        return detectionResults[index].promise.then((result) => {
          log.push(`detect-end:${sampleTime.toFixed(4)}`)
          return result
        })
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
    expect(frames.every((frame) => frame.seekMs >= 0 && frame.frameIntervalMs >= 1)).toBe(true)
    expect(log.indexOf('seek:0.2000')).toBeLessThan(log.indexOf('detect-end:0.0001'))
    expect(log.indexOf('frame:0.0001')).toBeLessThan(log.indexOf('detect-start:0.2000'))
    expect(log.indexOf('seek:0.4000')).toBeLessThan(log.indexOf('detect-end:0.2000'))
    expect(displayCanvas.draws).toHaveLength(3)
    expect(presentationCanvas.draws).toHaveLength(3)
  })
})
