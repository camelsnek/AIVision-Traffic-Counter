import { Tensor } from '@huggingface/transformers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VehicleDetector } from '../src/services/vehicleDetector'
import type { EngineInfo, RectNorm } from '../src/types'

const INFO: EngineInfo = {
  modelProfileId: 'onnx-community/yolov10n',
  device: 'webgpu',
  dtype: 'fp32',
}
const FULL_FRAME: RectNorm = { left: 0, top: 0, width: 1, height: 1 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VehicleDetector prepared input slots', () => {
  it('keeps two tensor buffers isolated until their sequential inferences settle', async () => {
    const harness = createDetectorHarness()
    harness.pixelValue = 32
    const first = harness.detector.prepare({}, 640, 640, FULL_FRAME, 0.35, 'standard-v1')
    const firstInference = first.infer()

    harness.pixelValue = 224
    const second = harness.detector.prepare({}, 640, 640, FULL_FRAME, 0.35, 'standard-v1')
    expect(() =>
      harness.detector.prepare({}, 640, 640, FULL_FRAME, 0.35, 'standard-v1'),
    ).toThrow('bounded two-frame capacity')
    expect(harness.inputValues).toHaveLength(1)
    expect(harness.inputValues[0]).toBeCloseTo(32 / 255, 6)

    harness.inferences[0].resolve(emptyModelOutput())
    await firstInference
    const secondInference = second.infer()
    expect(harness.inputValues).toHaveLength(2)
    expect(harness.inputValues[0]).toBeCloseTo(32 / 255, 6)
    expect(harness.inputValues[1]).toBeCloseTo(224 / 255, 6)

    harness.inferences[1].resolve(emptyModelOutput())
    await secondInference
    const reusable = harness.detector.prepare({}, 640, 640, FULL_FRAME, 0.35, 'standard-v1')
    reusable.dispose()
    await harness.detector.dispose()
    expect(harness.disposeModel).toHaveBeenCalledOnce()
  })

  it('waits for running and prepared leases before disposing tensors and the model', async () => {
    const harness = createDetectorHarness()
    const running = harness.detector.prepare({}, 640, 640, FULL_FRAME, 0.35, 'standard-v1')
    const inference = running.infer()
    const queued = harness.detector.prepare({}, 640, 640, FULL_FRAME, 0.35, 'standard-v1')

    const disposal = harness.detector.dispose()
    await Promise.resolve()
    expect(harness.disposeModel).not.toHaveBeenCalled()
    expect(() =>
      harness.detector.prepare({}, 640, 640, FULL_FRAME, 0.35, 'standard-v1'),
    ).toThrow('being disposed')

    queued.dispose()
    harness.inferences[0].resolve(emptyModelOutput())
    await inference
    await disposal
    expect(harness.disposeModel).toHaveBeenCalledOnce()
  })
})

function createDetectorHarness() {
  let pixelValue = 0
  const inputValues: number[] = []
  const inferences: Array<PromiseWithResolvers<Record<string, Tensor>>> = []
  const disposeModel = vi.fn(async () => undefined)
  const context = {
    drawImage: () => undefined,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(pixelValue),
    }),
  }
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
  })

  const model = Object.assign(
    ({ images }: { images: Tensor }) => {
      inputValues.push(Number(images.data[0]))
      const result = Promise.withResolvers<Record<string, Tensor>>()
      inferences.push(result)
      return result.promise
    },
    {
      config: { id2label: { 2: 'car' } },
      dispose: disposeModel,
    },
  )
  const DetectorConstructor = VehicleDetector as unknown as new (
    info: EngineInfo,
    model: typeof model,
  ) => VehicleDetector
  const detector = new DetectorConstructor(INFO, model)

  return {
    detector,
    disposeModel,
    inferences,
    inputValues,
    get pixelValue() {
      return pixelValue
    },
    set pixelValue(value: number) {
      pixelValue = value
    },
  }
}

function emptyModelOutput(): Record<string, Tensor> {
  return {
    output0: new Tensor('float32', new Float32Array([0, 0, 0, 0, 0, 2]), [1, 1, 6]),
  }
}
