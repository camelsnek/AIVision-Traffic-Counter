import { AutoModel, Tensor, env } from '@huggingface/transformers'
import type { PreTrainedModel } from '@huggingface/transformers'

import ortAsyncifyMjsUrl from '../../vendor/ort/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortAsyncifyWasmUrl from '../../vendor/ort/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortPlainMjsUrl from '../../vendor/ort/ort-wasm-simd-threaded.mjs?url'
import ortPlainWasmUrl from '../../vendor/ort/ort-wasm-simd-threaded.wasm?url'
import { clamp01, intersectionOverUnion } from '../lib/geometry'
import { preprocessRgba } from '../lib/framePreprocessing'
import { getModelProfile } from '../lib/modelProfiles'
import { fillYoloInput, YOLO_INPUT_EDGE } from '../lib/yoloInput'
import type {
  Detection,
  EngineDevice,
  EngineInfo,
  EnginePreference,
  ModelProfileId,
  PreprocessingProfileId,
  RectNorm,
  VehicleClass,
} from '../types'

const VEHICLE_LABELS: Record<string, VehicleClass> = {
  car: 'car',
  truck: 'truck',
  bus: 'bus',
  motorcycle: 'motorcycle',
}

/** YOLO's fixed square input edge; source crops are scaled to fit it. */
const MAX_CROP_EDGE = YOLO_INPUT_EDGE
/** Same-class boxes above this IoU are duplicates of one object. */
const SAME_CLASS_IOU = 0.6
/** Any-class boxes above this IoU are one object detected as two classes. */
const CROSS_CLASS_IOU = 0.82
/** Runtime init can hang (not reject) in broken environments. */
const RUNTIME_INIT_TIMEOUT_MS = 25_000

// Serve everything locally: model weights from public/models, the ONNX wasm
// runtime as Vite-managed assets vendored by scripts/sync-ort-assets.mjs.
// No network access is required at runtime. Mirrors transformers.js's own
// build selection: the plain flavor on Safari, asyncify everywhere else.
env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = '/models/'
env.useBrowserCache = false
if (env.backends.onnx?.wasm) {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  env.backends.onnx.wasm.wasmPaths = isSafari
    ? { mjs: ortPlainMjsUrl, wasm: ortPlainWasmUrl }
    : { mjs: ortAsyncifyMjsUrl, wasm: ortAsyncifyWasmUrl }
  // ORT environment flags must be stable before the first GPU or CPU session.
  // Single-thread, no proxy worker avoids the ESM worker bootstrap crash seen
  // in browsers where Emscripten's worker checks misdetect the environment.
  env.backends.onnx.wasm.proxy = false
  env.backends.onnx.wasm.numThreads = 1
}
if (env.backends.onnx?.webgpu) {
  env.backends.onnx.webgpu.powerPreference = 'high-performance'
}

export interface DetectorTimings {
  /** Canvas crop draw and synchronous pixel readback. */
  captureMs: number
  /** Optional application preprocessing, before tensor construction. */
  preprocessingMs: number
  /** Direct RGB rescaling, NCHW layout, and top-left padding. */
  tensorMs: number
  /** ONNX model execution. */
  inferenceMs: number
  /** Output parsing, duplicate suppression, and tensor disposal. */
  postprocessMs: number
  /** Sum of capture, preprocessing, tensor, inference, and postprocessing work. */
  totalMs: number
}

export interface DetectorResult {
  detections: Detection[]
  timings: DetectorTimings
}

export interface PreparedDetectorFrame {
  infer(): Promise<DetectorResult>
  dispose(): void
}

interface CapturedFrame {
  cropWidth: number
  cropHeight: number
  roi: RectNorm
  minConfidence: number
  captureMs: number
  preprocessingMs: number
  tensorMs: number
}

interface DetectorInputSlot {
  readonly buffer: Float32Array
  readonly tensor: Tensor
  leased: boolean
}

/**
 * Single-pass YOLOv10 vehicle detector.
 *
 * Auto mode prefers WebGPU and falls back to quantized WASM. Explicit GPU
 * and CPU choices are honored without silently changing hardware.
 */
export class VehicleDetector {
  readonly info: EngineInfo

  private readonly model: PreTrainedModel
  private readonly labelById: Map<number, string>
  private readonly cropCanvas = document.createElement('canvas')
  private readonly cropContext: CanvasRenderingContext2D
  private readonly inputSlots = createInputSlots(2)
  private inferenceRunning = false
  private disposePromise: Promise<void> | null = null
  private readonly idleWaiters: Array<() => void> = []

  private constructor(info: EngineInfo, model: PreTrainedModel) {
    const cropContext = this.cropCanvas.getContext('2d')
    if (!cropContext) {
      throw new Error('Unable to prepare frames for the detector.')
    }
    this.cropContext = cropContext
    this.info = info
    this.model = model
    this.labelById = readLabelMap(model.config)
  }

  static supportsWebGpu(): Promise<boolean> {
    return supportsWebGpu()
  }

  static async create(
    modelProfileId: ModelProfileId,
    preference: EnginePreference = 'auto',
  ): Promise<VehicleDetector> {
    const profile = getModelProfile(modelProfileId)
    const preferred = await resolveDevice(preference)

    try {
      return await VehicleDetector.load(profile.id, preferred, profile.hasQuantized)
    } catch (error) {
      if (preference !== 'auto' || preferred === 'wasm') {
        throw error
      }
      // Auto mode alone may fall back when an adapter exists but session creation fails.
      return VehicleDetector.load(profile.id, 'wasm', profile.hasQuantized)
    }
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.disposeWhenIdle()
    return this.disposePromise
  }

  private async disposeWhenIdle(): Promise<void> {
    if (this.inputSlots.some((slot) => slot.leased)) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve))
    }
    for (const slot of this.inputSlots) {
      slot.tensor.dispose()
    }
    await this.model.dispose()
  }

  private static async load(
    modelProfileId: ModelProfileId,
    device: EngineDevice,
    hasQuantized: boolean,
  ): Promise<VehicleDetector> {
    // WebGPU uses FP32; WASM uses the quantized weights when the profile has them.

    const dtype = device === 'wasm' && hasQuantized ? 'q8' : 'fp32'
    const model = await withTimeout(
      AutoModel.from_pretrained(modelProfileId, {
        device,
        dtype,
        local_files_only: true,
        subfolder: 'onnx',
      }),
      RUNTIME_INIT_TIMEOUT_MS,
    )
    return new VehicleDetector({ modelProfileId, device, dtype }, model)
  }

  /**
   * Captures and prepares pixels synchronously into a leased tensor slot.
   * The source may be released when this method returns; the lease remains
   * owned by the returned frame until inference settles or it is disposed.
   */
  prepare(
    source: CanvasImageSource,
    frameWidth: number,
    frameHeight: number,
    roi: RectNorm,
    minConfidence: number,
    preprocessingProfileId: PreprocessingProfileId,
  ): PreparedDetectorFrame {
    if (!frameWidth || !frameHeight) {
      throw new Error('Video frame is not ready yet.')
    }

    const slot = this.acquireInputSlot()
    try {
      const sourceLeft = Math.round(roi.left * frameWidth)
      const sourceTop = Math.round(roi.top * frameHeight)
      const sourceWidth = Math.max(1, Math.round(roi.width * frameWidth))
      const sourceHeight = Math.max(1, Math.round(roi.height * frameHeight))

      const scale = MAX_CROP_EDGE / Math.max(sourceWidth, sourceHeight)
      const cropWidth = Math.max(1, Math.round(sourceWidth * scale))
      const cropHeight = Math.max(1, Math.round(sourceHeight * scale))

      if (this.cropCanvas.width !== cropWidth) {
        this.cropCanvas.width = cropWidth
      }
      if (this.cropCanvas.height !== cropHeight) {
        this.cropCanvas.height = cropHeight
      }

      const captureStart = performance.now()
      this.cropContext.drawImage(
        source,
        sourceLeft,
        sourceTop,
        sourceWidth,
        sourceHeight,
        0,
        0,
        cropWidth,
        cropHeight,
      )
      const sourcePixels = this.cropContext.getImageData(0, 0, cropWidth, cropHeight).data
      const captureMs = performance.now() - captureStart

      const preprocessingStart = performance.now()
      const inputPixels = preprocessRgba(
        sourcePixels,
        cropWidth,
        cropHeight,
        preprocessingProfileId,
      )
      const preprocessingMs = performance.now() - preprocessingStart

      const tensorStart = performance.now()
      fillYoloInput(inputPixels, cropWidth, cropHeight, slot.buffer)
      const tensorMs = performance.now() - tensorStart
      const frame: CapturedFrame = {
        cropWidth,
        cropHeight,
        roi,
        minConfidence,
        captureMs,
        preprocessingMs,
        tensorMs,
      }
      let state: 'prepared' | 'running' | 'released' = 'prepared'

      return {
        infer: () => {
          if (state !== 'prepared') {
            return Promise.reject(new Error('A prepared detector frame can only be inferred once.'))
          }
          state = 'running'
          return this.detectCaptured(frame, slot.tensor).finally(() => {
            state = 'released'
            this.releaseInputSlot(slot)
          })
        },
        dispose: () => {
          if (state === 'prepared') {
            state = 'released'
            this.releaseInputSlot(slot)
          }
        },
      }
    } catch (error) {
      this.releaseInputSlot(slot)
      throw error
    }
  }

  private async detectCaptured(
    frame: CapturedFrame,
    inputTensor: Tensor,
  ): Promise<DetectorResult> {
    if (this.inferenceRunning) {
      throw new Error('Detector inference must remain sequential.')
    }
    this.inferenceRunning = true

    try {
      const inferenceStart = performance.now()
      const outputs = await this.model({ images: inputTensor })
      const inferenceMs = performance.now() - inferenceStart

      const postprocessStart = performance.now()
      const output0 = 'output0' in outputs ? outputs.output0 : null
      if (!(output0 instanceof Tensor)) {
        throw new Error('The YOLO model returned an unexpected output.')
      }

      let detections: Detection[]
      try {
        detections = suppressDuplicates(
          this.parsePredictions(output0, {
            inputWidth: frame.cropWidth,
            inputHeight: frame.cropHeight,
            roi: frame.roi,
            minConfidence: frame.minConfidence,
          }),
        )
      } finally {
        output0.dispose()
      }
      const postprocessMs = performance.now() - postprocessStart
      const totalMs =
        frame.captureMs +
        frame.preprocessingMs +
        frame.tensorMs +
        inferenceMs +
        postprocessMs

      return {
        detections,
        timings: {
          captureMs: frame.captureMs,
          preprocessingMs: frame.preprocessingMs,
          tensorMs: frame.tensorMs,
          inferenceMs,
          postprocessMs,
          totalMs,
        },
      }
    } finally {
      this.inferenceRunning = false
    }
  }

  private acquireInputSlot(): DetectorInputSlot {
    if (this.disposePromise) {
      throw new Error('The detector is being disposed.')
    }
    for (const slot of this.inputSlots) {
      if (!slot.leased) {
        slot.leased = true
        return slot
      }
    }
    throw new Error('Detector preparation exceeded its bounded two-frame capacity.')
  }

  private releaseInputSlot(slot: DetectorInputSlot) {
    slot.leased = false
    for (const candidate of this.inputSlots) {
      if (candidate.leased) {
        return
      }
    }
    for (const resolve of this.idleWaiters.splice(0)) {
      resolve()
    }
  }

  private parsePredictions(
    output0: Tensor,
    args: { inputWidth: number; inputHeight: number; roi: RectNorm; minConfidence: number },
  ): Detection[] {
    // output0: [1, N, 6] rows of [xmin, ymin, xmax, ymax, score, classId]
    // in resized-input pixels (image anchored top-left inside the padded square).
    const rows = output0.dims.length === 3 ? output0.dims[1] : 0
    const data = output0.data
    const detections: Detection[] = []

    for (let row = 0; row < rows; row += 1) {
      const offset = row * 6
      const score = Number(data[offset + 4])
      if (score < args.minConfidence) {
        continue
      }

      const label = this.labelById.get(Number(data[offset + 5]))
      const vehicleClass = label ? VEHICLE_LABELS[label] : undefined
      if (!vehicleClass) {
        continue
      }

      const left = clamp01(Number(data[offset]) / args.inputWidth)
      const top = clamp01(Number(data[offset + 1]) / args.inputHeight)
      const right = clamp01(Number(data[offset + 2]) / args.inputWidth)
      const bottom = clamp01(Number(data[offset + 3]) / args.inputHeight)
      if (right <= left || bottom <= top) {
        continue
      }

      detections.push({
        vehicleClass,
        confidence: score,
        box: {
          left: args.roi.left + left * args.roi.width,
          top: args.roi.top + top * args.roi.height,
          width: (right - left) * args.roi.width,
          height: (bottom - top) * args.roi.height,
        },
      })
    }

    return detections
  }
}

let webGpuAvailability: Promise<boolean> | null = null

function supportsWebGpu(): Promise<boolean> {
  webGpuAvailability ??= (async () => {
    try {
      return Boolean(await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }))
    } catch {
      return false
    }
  })()
  return webGpuAvailability
}

async function resolveDevice(preference: EnginePreference): Promise<EngineDevice> {
  if (preference === 'cpu') {
    return 'wasm'
  }

  const gpuAvailable = await supportsWebGpu()
  if (preference === 'gpu' && !gpuAvailable) {
    throw new Error(
      'GPU inference is unavailable. Use a current Chrome or Edge build with hardware acceleration, or choose Auto/CPU.',
    )
  }
  return gpuAvailable ? 'webgpu' : 'wasm'
}

function createInputSlots(count: number): DetectorInputSlot[] {
  return Array.from({ length: count }, () => {
    const buffer = new Float32Array(3 * YOLO_INPUT_EDGE * YOLO_INPUT_EDGE)
    return {
      buffer,
      tensor: new Tensor('float32', buffer, [1, 3, YOLO_INPUT_EDGE, YOLO_INPUT_EDGE]),
      leased: false,
    }
  })
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const timeoutId = window.setTimeout(
    () => reject(new Error('Timed out initializing the inference runtime.')),
    timeoutMs,
  )
  work.then(
    (value) => {
      window.clearTimeout(timeoutId)
      resolve(value)
    },
    (error: unknown) => {
      window.clearTimeout(timeoutId)
      reject(error instanceof Error ? error : new Error(String(error)))
    },
  )
  return promise
}

function readLabelMap(config: unknown): Map<number, string> {
  const labels = new Map<number, string>()
  if (config && typeof config === 'object' && 'id2label' in config) {
    const raw = config.id2label
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        const id = Number(key)
        if (Number.isFinite(id) && typeof value === 'string') {
          labels.set(id, value)
        }
      }
    }
  }
  return labels
}


/**
 * YOLOv10 is NMS-free, but low thresholds still yield the occasional double
 * box (same object as two classes, or two near-identical boxes). Keep the
 * highest-confidence box per object.
 */
function suppressDuplicates(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
  const kept: Detection[] = []

  for (const candidate of sorted) {
    const duplicate = kept.some((existing) => {
      const iou = intersectionOverUnion(existing.box, candidate.box)
      const threshold = existing.vehicleClass === candidate.vehicleClass ? SAME_CLASS_IOU : CROSS_CLASS_IOU
      return iou >= threshold
    })
    if (!duplicate) {
      kept.push(candidate)
    }
  }

  return kept
}
