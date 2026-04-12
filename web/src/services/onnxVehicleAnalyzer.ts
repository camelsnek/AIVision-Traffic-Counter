import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers'

import type { AnalysisConfig, DetectionBox, DetectionRegion, ScanPreset, VehicleClass } from '../types'

import type { VehicleAnalyzer } from './vehicleAnalyzer'

const MODEL_ID = 'onnx-community/yolov10n'
const VEHICLE_LABELS = new Set<VehicleClass>(['car', 'truck', 'bus', 'motorcycle'])

env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = '/models/'
env.useBrowserCache = false

export class OnnxVehicleAnalyzer implements VehicleAnalyzer {
  readonly kind = 'onnx' as const

  private model: Awaited<ReturnType<typeof AutoModel.from_pretrained>> | null = null
  private processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
  private confidenceThreshold: number
  private scanPreset: ScanPreset
  private detailLevel: number
  private readonly inputCanvas = document.createElement('canvas')
  private readonly tileCanvas = document.createElement('canvas')

  constructor(config: AnalysisConfig) {
    this.confidenceThreshold = config.confidenceThreshold
    this.scanPreset = config.scanPreset
    this.detailLevel = config.detailLevel
  }

  async initialize(config: AnalysisConfig) {
    this.updateConfig(config)
    this.model = await AutoModel.from_pretrained(MODEL_ID, {
      local_files_only: true,
      subfolder: 'onnx',
      model_file_name: 'model',
    })
    this.processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      local_files_only: true,
    })
  }

  updateConfig(config: AnalysisConfig) {
    this.confidenceThreshold = config.confidenceThreshold
    this.scanPreset = config.scanPreset
    this.detailLevel = config.detailLevel
  }

  async analyze(source: CanvasImageSource, region: DetectionRegion) {
    if (!this.model || !this.processor) {
      throw new Error('Vehicle detector is not initialized.')
    }

    const canvas = this.ensureCanvas(source)
    const passes = buildDetectionPasses(region, this.scanPreset, this.detailLevel)
    const groupedDetections: DetectionBox[][] = []

    for (const pass of passes) {
      groupedDetections.push(await this.runDetectionPass(canvas, pass))
    }

    return mergeTileDetections(groupedDetections.flat(), this.scanPreset, this.detailLevel)
  }

  private ensureCanvas(source: CanvasImageSource) {
    const width = readWidth(source)
    const height = readHeight(source)
    if (!width || !height) {
      throw new Error('Video frame is not ready yet.')
    }

    if (this.inputCanvas.width !== width) {
      this.inputCanvas.width = width
    }
    if (this.inputCanvas.height !== height) {
      this.inputCanvas.height = height
    }

    const context = this.inputCanvas.getContext('2d')
    if (!context) {
      throw new Error('Unable to prepare a frame for the detector.')
    }

    context.clearRect(0, 0, width, height)
    context.drawImage(source, 0, 0, width, height)
    return this.inputCanvas
  }

  private async runDetectionPass(canvas: HTMLCanvasElement, pass: DetectionPass) {
    const cropCanvas = this.prepareCropCanvas(canvas, pass)
    const rawImage = RawImage.fromCanvas(cropCanvas)
    const { pixel_values, reshaped_input_sizes } = await this.processor!(rawImage)
    const outputs = await this.model!({ images: pixel_values })
    const output0 = (outputs as { output0?: { tolist(): number[][][] } }).output0

    if (!output0) {
      throw new Error('The YOLO model returned an unexpected output.')
    }

    const predictions = output0.tolist()[0] ?? []
    const [newHeight, newWidth] = reshaped_input_sizes[0] ?? [rawImage.height, rawImage.width]
    const scaleX = rawImage.width / newWidth
    const scaleY = rawImage.height / newHeight

    return predictions
      .map(([xmin, ymin, xmax, ymax, score, id]) => {
        const labelMap = (this.model?.config as { id2label?: Record<number, string> } | undefined)?.id2label
        const label = labelMap?.[id]
        const normalizedLabel = normalizeLabel(label)
        if (!normalizedLabel || !VEHICLE_LABELS.has(normalizedLabel) || score < this.confidenceThreshold) {
          return null
        }

        const left = pass.left + ((xmin * scaleX) / rawImage.width) * pass.width
        const top = pass.top + ((ymin * scaleY) / rawImage.height) * pass.height
        const right = pass.left + ((xmax * scaleX) / rawImage.width) * pass.width
        const bottom = pass.top + ((ymax * scaleY) / rawImage.height) * pass.height

        return {
          vehicleClass: normalizedLabel,
          confidence: score,
          left: clamp01(left),
          top: clamp01(top),
          width: clamp01(right - left),
          height: clamp01(bottom - top),
        } satisfies DetectionBox
      })
      .filter((entry): entry is DetectionBox => entry !== null)
  }

  private prepareCropCanvas(source: HTMLCanvasElement, pass: DetectionPass) {
    const pixelLeft = Math.round(pass.left * source.width)
    const pixelTop = Math.round(pass.top * source.height)
    const pixelWidth = Math.max(1, Math.round(pass.width * source.width))
    const pixelHeight = Math.max(1, Math.round(pass.height * source.height))

    if (this.tileCanvas.width !== pixelWidth) {
      this.tileCanvas.width = pixelWidth
    }
    if (this.tileCanvas.height !== pixelHeight) {
      this.tileCanvas.height = pixelHeight
    }

    const context = this.tileCanvas.getContext('2d')
    if (!context) {
      throw new Error('Unable to prepare a cropped frame for the detector.')
    }

    context.clearRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(
      source,
      pixelLeft,
      pixelTop,
      pixelWidth,
      pixelHeight,
      0,
      0,
      pixelWidth,
      pixelHeight,
    )

    return this.tileCanvas
  }
}

interface DetectionPass {
  left: number
  top: number
  width: number
  height: number
}

function normalizeLabel(value: unknown): VehicleClass | null {
  switch (`${value}`.toLowerCase()) {
    case 'car':
      return 'car'
    case 'truck':
      return 'truck'
    case 'bus':
      return 'bus'
    case 'motorcycle':
      return 'motorcycle'
    default:
      return null
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function buildDetectionPasses(region: DetectionRegion, preset: ScanPreset, detailLevel: number) {
  const normalizedRegion = normalizeRegion(region)
  const regionArea = normalizedRegion.width * normalizedRegion.height
  const zoneBoost = regionArea <= 0.18 || normalizedRegion.height <= 0.22 ? 1 : 0
  const presetMinimum = preset === 'dense' ? 3 : preset === 'balanced' ? 2 : 1
  const effectiveDetail = clampDetail(Math.max(detailLevel, presetMinimum) + zoneBoost)
  const passes = [normalizedRegion]

  if (effectiveDetail >= 2) {
    passes.push(...createOverlappingGrid(normalizedRegion, 2, 1, 0.32))
  }

  if (effectiveDetail >= 3) {
    passes.push(...createOverlappingGrid(normalizedRegion, 2, 2, 0.26))
  }

  if (effectiveDetail >= 4) {
    passes.push(...createOverlappingGrid(normalizedRegion, 3, 2, 0.22))
  }

  if (effectiveDetail >= 5) {
    passes.push(...createOverlappingGrid(normalizedRegion, 4, 2, 0.2))
  }

  return dedupePasses(passes)
}

function mergeTileDetections(detections: DetectionBox[], preset: ScanPreset, detailLevel: number) {
  const sorted = [...detections].sort((left, right) => right.confidence - left.confidence)
  const merged: DetectionBox[] = []
  const iouThreshold = resolveMergeIouThreshold(preset, detailLevel)

  while (sorted.length > 0) {
    const current = sorted.shift()
    if (!current) {
      break
    }

    merged.push(current)

    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const candidate = sorted[index]
      if (!candidate || candidate.vehicleClass !== current.vehicleClass) {
        continue
      }

      if (intersectionOverUnion(current, candidate) >= iouThreshold) {
        sorted.splice(index, 1)
      }
    }
  }

  return merged
}

function normalizeRegion(region: DetectionRegion): DetectionPass {
  const left = clamp01(region.left)
  const top = clamp01(region.top)
  const width = Math.min(1 - left, Math.max(0.1, region.width))
  const height = Math.min(1 - top, Math.max(0.1, region.height))

  return { left, top, width, height }
}

function createOverlappingGrid(region: DetectionPass, columns: number, rows: number, overlapRatio: number) {
  const safeColumns = Math.max(1, columns)
  const safeRows = Math.max(1, rows)
  const horizontalStep = safeColumns === 1 ? region.width : region.width / safeColumns
  const verticalStep = safeRows === 1 ? region.height : region.height / safeRows
  const overlapWidth = safeColumns === 1 ? 0 : horizontalStep * overlapRatio
  const overlapHeight = safeRows === 1 ? 0 : verticalStep * overlapRatio
  const tileWidth = Math.min(region.width, horizontalStep + overlapWidth)
  const tileHeight = Math.min(region.height, verticalStep + overlapHeight)
  const passes: DetectionPass[] = []

  for (let row = 0; row < safeRows; row += 1) {
    for (let column = 0; column < safeColumns; column += 1) {
      const unclampedLeft = region.left + column * horizontalStep - overlapWidth / 2
      const unclampedTop = region.top + row * verticalStep - overlapHeight / 2
      const left = clamp(unclampedLeft, region.left, region.left + region.width - tileWidth)
      const top = clamp(unclampedTop, region.top, region.top + region.height - tileHeight)

      passes.push({
        left,
        top,
        width: tileWidth,
        height: tileHeight,
      })
    }
  }

  return passes
}

function dedupePasses(passes: DetectionPass[]) {
  const seen = new Set<string>()
  return passes.filter((pass) => {
    const key = [pass.left, pass.top, pass.width, pass.height].map((value) => value.toFixed(4)).join(':')
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function resolveMergeIouThreshold(preset: ScanPreset, detailLevel: number) {
  const presetBase = preset === 'dense' ? 0.56 : preset === 'balanced' ? 0.5 : 0.44
  return Math.min(0.68, presetBase + Math.max(0, detailLevel - 1) * 0.03)
}

function clampDetail(value: number) {
  return clamp(Math.round(value), 1, 5)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function intersectionOverUnion(left: DetectionBox, right: DetectionBox) {
  const overlapLeft = Math.max(left.left, right.left)
  const overlapTop = Math.max(left.top, right.top)
  const overlapRight = Math.min(left.left + left.width, right.left + right.width)
  const overlapBottom = Math.min(left.top + left.height, right.top + right.height)

  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    return 0
  }

  const intersection = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

function readWidth(source: CanvasImageSource) {
  if ('videoWidth' in source && typeof source.videoWidth === 'number') {
    return source.videoWidth
  }
  if ('naturalWidth' in source && typeof source.naturalWidth === 'number') {
    return source.naturalWidth
  }
  if ('width' in source && typeof source.width === 'number') {
    return source.width
  }
  return 0
}

function readHeight(source: CanvasImageSource) {
  if ('videoHeight' in source && typeof source.videoHeight === 'number') {
    return source.videoHeight
  }
  if ('naturalHeight' in source && typeof source.naturalHeight === 'number') {
    return source.naturalHeight
  }
  if ('height' in source && typeof source.height === 'number') {
    return source.height
  }
  return 0
}
