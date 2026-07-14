export const vehicleClasses = ['car', 'truck', 'bus', 'motorcycle'] as const

export type VehicleClass = (typeof vehicleClasses)[number]

/** Crossing direction in screen space; x increases right and y increases down. */
export type Direction = 'down' | 'up' | 'right' | 'left'

export type LineOrientation = 'horizontal' | 'vertical'

export type ModelProfileId = 'onnx-community/yolov10n' | 'onnx-community/yolov10m'

/** User-selected inference hardware. Auto prefers WebGPU and falls back to CPU/WASM. */
export type EnginePreference = 'auto' | 'gpu' | 'cpu'

/** Axis-aligned rectangle, all values normalized to [0, 1] frame space. */
export interface RectNorm {
  left: number
  top: number
  width: number
  height: number
}

export interface PointNorm {
  x: number
  y: number
}

/**
 * A counting zone: vehicles are counted exactly once when a confirmed
 * track crosses the zone's line while inside the line's bounded extent.
 */
export interface CountingZone {
  id: string
  label: string
  region: RectNorm
  lineOrientation: LineOrientation
  /**
   * Position of the line on its perpendicular axis: top-to-bottom for a
   * horizontal line, left-to-right for a vertical line.
   */
  lineOffset: number
}

/** A single-frame detector output, normalized to full-frame space. */
export interface Detection {
  vehicleClass: VehicleClass
  confidence: number
  box: RectNorm
}

/** Immutable per-frame view of a live track, for overlay rendering. */
export interface TrackSnapshot {
  id: number
  vehicleClass: VehicleClass
  confidence: number
  box: RectNorm
  /** Number of matched detections over the track lifetime. */
  hits: number
  /** True once the track has enough hits to be eligible for counting. */
  confirmed: boolean
  /** True when this frame's position is predicted (no detection matched). */
  coasting: boolean
  /** Recent real observation centers, oldest first. */
  trail: PointNorm[]
  /** Zone ids this track has already been counted in. */
  countedZones: string[]
}

/** One vehicle counted crossing one zone's line. */
export interface CountEvent {
  /** Monotonic sequence number within a session. */
  seq: number
  trackId: number
  zoneId: string
  vehicleClass: VehicleClass
  direction: Direction
  /** Video timestamp of the crossing, in seconds. */
  videoTime: number
}

export interface AnalysisConfig {
  modelProfileId: ModelProfileId
  enginePreference: EnginePreference
  /** Minimum detection confidence, 0..1. */
  confidence: number
  /** Analysis sampling rate in video-time frames per second. */
  samplingFps: number
  zones: CountingZone[]
}

export type EngineDevice = 'webgpu' | 'wasm'

export interface EngineInfo {
  modelProfileId: ModelProfileId
  device: EngineDevice
  dtype: 'fp32' | 'q8'
}

export interface DirectionCounts {
  down: number
  up: number
  right: number
  left: number
}

export interface ZoneCounts {
  zoneId: string
  label: string
  lineOrientation: LineOrientation
  total: number
  byDirection: DirectionCounts
  byClass: Record<VehicleClass, number>
}

export interface SessionCounts {
  total: number
  byClass: Record<VehicleClass, number>
  byDirection: DirectionCounts
  zones: ZoneCounts[]
}

export interface FlowBucket {
  /** Bucket start, video seconds. */
  start: number
  /** Bucket length, seconds. */
  length: number
  count: number
}
