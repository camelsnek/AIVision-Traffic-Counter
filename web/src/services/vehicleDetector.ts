import { AutoModel, AutoProcessor, RawImage, Tensor, env } from '@huggingface/transformers'
import type { PreTrainedModel, Processor } from '@huggingface/transformers'

import ortAsyncifyMjsUrl from '../../vendor/ort/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortAsyncifyWasmUrl from '../../vendor/ort/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortPlainMjsUrl from '../../vendor/ort/ort-wasm-simd-threaded.mjs?url'
import ortPlainWasmUrl from '../../vendor/ort/ort-wasm-simd-threaded.wasm?url'
import { clamp01, intersectionOverUnion } from '../lib/geometry'
import { getModelProfile } from '../lib/modelProfiles'
import type { Detection, EngineDevice, EngineInfo, ModelProfileId, RectNorm, VehicleClass } from '../types'

const VEHICLE_LABELS: Record<string, VehicleClass> = {
  car: 'car',
  truck: 'truck',
  bus: 'bus',
  motorcycle: 'motorcycle',
}

/** Longest edge of the ROI crop handed to the processor; it resizes to 640 anyway. */
const MAX_CROP_EDGE = 1280
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
}

/**
 * Single-pass YOLOv10 vehicle detector.
 *
 * Runs on WebGPU when the browser exposes an adapter, otherwise on
 * (threaded, proxied) WASM with the quantized model when one is available.
 */
export class VehicleDetector {
  readonly info: EngineInfo

  private readonly model: PreTrainedModel
  private readonly processor: Processor
  private readonly labelById: Map<number, string>
  private readonly cropCanvas = document.createElement('canvas')

  private constructor(info: EngineInfo, model: PreTrainedModel, processor: Processor) {
    this.info = info
    this.model = model
    this.processor = processor
    this.labelById = readLabelMap(model.config)
  }

  static async create(modelProfileId: ModelProfileId): Promise<VehicleDetector> {
    const profile = getModelProfile(modelProfileId)
    const preferred = await resolveDevice()

    try {
      return await VehicleDetector.load(profile.id, preferred, profile.hasQuantized)
    } catch (error) {
      if (preferred === 'wasm') {
        throw error
      }
      // WebGPU adapters can exist yet fail session creation; WASM is the safety net.
      return VehicleDetector.load(profile.id, 'wasm', profile.hasQuantized)
    }
  }

  private static async load(
    modelProfileId: ModelProfileId,
    device: EngineDevice,
    hasQuantized: boolean,
  ): Promise<VehicleDetector> {
    const wasmEnv = env.backends.onnx?.wasm
    if (device === 'wasm' && wasmEnv) {
      // Single-thread, no proxy worker: the ORT ESM bundle misdetects module
      // workers in some environments (Emscripten checks `importScripts`) and
      // crashes with "document is not defined" in both the proxy worker and
      // pthread workers. ORT latches its wasm init globally on first use, so
      // this cannot be retried after a failure — pick the profile that works
      // everywhere. WebGPU remains the fast path.
      wasmEnv.proxy = false
      wasmEnv.numThreads = 1
    }

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
    const processor = await AutoProcessor.from_pretrained(modelProfileId, {
      local_files_only: true,
    })

    return new VehicleDetector({ modelProfileId, device, dtype }, model, processor)
  }

  /**
   * Detects vehicles inside `roi` (normalized full-frame rect) of the current
   * video frame. Returned boxes are normalized to the FULL frame.
   */
  async detect(video: HTMLVideoElement, roi: RectNorm, minConfidence: number): Promise<Detection[]> {
    const frameWidth = video.videoWidth
    const frameHeight = video.videoHeight
    if (!frameWidth || !frameHeight) {
      throw new Error('Video frame is not ready yet.')
    }

    const sourceLeft = Math.round(roi.left * frameWidth)
    const sourceTop = Math.round(roi.top * frameHeight)
    const sourceWidth = Math.max(1, Math.round(roi.width * frameWidth))
    const sourceHeight = Math.max(1, Math.round(roi.height * frameHeight))

    const scale = Math.min(1, MAX_CROP_EDGE / Math.max(sourceWidth, sourceHeight))
    const cropWidth = Math.max(1, Math.round(sourceWidth * scale))
    const cropHeight = Math.max(1, Math.round(sourceHeight * scale))

    if (this.cropCanvas.width !== cropWidth) {
      this.cropCanvas.width = cropWidth
    }
    if (this.cropCanvas.height !== cropHeight) {
      this.cropCanvas.height = cropHeight
    }

    const context = this.cropCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Unable to prepare a frame for the detector.')
    }
    context.drawImage(video, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, cropWidth, cropHeight)

    const image = RawImage.fromCanvas(this.cropCanvas)
    const processed = await this.processor(image)
    const outputs = await this.model({ images: processed.pixel_values })
    const output0 = 'output0' in outputs ? outputs.output0 : null
    if (!(output0 instanceof Tensor)) {
      throw new Error('The YOLO model returned an unexpected output.')
    }

    const [inputHeight, inputWidth] = readReshapedSize(processed, cropHeight, cropWidth)
    const detections = this.parsePredictions(output0, {
      inputWidth,
      inputHeight,
      roi,
      minConfidence,
    })
    output0.dispose()

    return suppressDuplicates(detections)
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

async function resolveDevice(): Promise<EngineDevice> {
  try {
    const adapter = await navigator.gpu?.requestAdapter()
    return adapter ? 'webgpu' : 'wasm'
  } catch {
    return 'wasm'
  }
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

function readReshapedSize(processed: unknown, fallbackHeight: number, fallbackWidth: number): [number, number] {
  if (processed && typeof processed === 'object' && 'reshaped_input_sizes' in processed) {
    const sizes = processed.reshaped_input_sizes
    if (Array.isArray(sizes) && Array.isArray(sizes[0])) {
      const [height, width] = sizes[0]
      if (typeof height === 'number' && typeof width === 'number' && height > 0 && width > 0) {
        return [height, width]
      }
    }
  }
  return [fallbackHeight, fallbackWidth]
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
