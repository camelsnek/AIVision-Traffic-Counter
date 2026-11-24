export const vehicleClasses = ['car', 'truck', 'bus', 'motorcycle'] as const

export type VehicleClass = (typeof vehicleClasses)[number]

/** Crossing direction in screen space; x increases right and y increases down. */
export type Direction = 'down' | 'up' | 'right' | 'left'

export type LineOrientation = 'horizontal' | 'vertical'

/** Inference hardware preference: auto = TensorRT/CUDA/DirectML if present, else CPU. */
export type DevicePreference = 'auto' | 'gpu' | 'cpu'

/** Versioned detector-input transform; profile ids are persisted in session exports. */
export type PreprocessingProfileId = 'standard-v1' | 'night-clahe-v1'

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

/** Mirrors `AnalysisConfig` in engine/aivision/schema.py (camelCase JSON). */
export interface AnalysisConfig {
  /** Detector model id, e.g. `rfdetr-small` (see GET /api/info). */
  modelId: string
  device: DevicePreference
  /** Recorded in exports; the Python engine currently applies no pixel transform. */
  preprocessingProfileId: PreprocessingProfileId
  /** Minimum detection confidence for starting a track, 0..1. */
  confidence: number
  /** Analysed frames per second of video time; 0 analyses every frame. */
  samplingFps: number
  zones: CountingZone[]
}

/** What the backend actually used for a run. */
export interface EngineInfo {
  modelId: string
  /** TensorRT, CUDA, DirectML or CPU. */
  provider: string
  precision: string
  inputSize: number
  /** Providers that failed before this one was chosen, if any. */
  fallbacks?: string
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
  byDirection: DirectionCounts
  /** Bucket start, video seconds. */
  start: number
  /** Bucket length, seconds. */
  length: number
  count: number
}
