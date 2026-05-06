export const vehicleClasses = [
  'car',
  'truck',
  'bus',
  'motorcycle',
] as const

export type VehicleClass = (typeof vehicleClasses)[number]

export type AnalyzerKind = 'onnx' | 'mock'
export type ScanPreset = 'fast' | 'balanced' | 'dense'
export type ModelProfileId = 'onnx-community/yolov10n' | 'onnx-community/yolov10m'

export interface DetectionRegion {
  left: number
  top: number
  width: number
  height: number
}

export interface DetectionZone {
  id: string
  label: string
  region: DetectionRegion
  countingLineOffset: number
}

export interface DetectionBox {
  vehicleClass: VehicleClass
  confidence: number
  left: number
  top: number
  width: number
  height: number
}

export interface TrackedVehicle {
  trackId: number
  vehicleClass: VehicleClass
  confidence: number
  boundingBox: DetectionBox
  framesVisible: number
  missedFrames: number
  framesSinceCounted: number
  velocityX: number
  velocityY: number
  previousCenterY: number
  previousBottomY: number
  maxBottomY: number
  maxConfidence: number
  counted: boolean
  zoneId?: string
  zoneLabel?: string
}

export interface AnalysisConfig {
  modelProfileId: ModelProfileId
  confidenceThreshold: number
  analysisIntervalMs: number
  detailLevel: number
  trackingBias: number
  detectionZones: DetectionZone[]
  activeZoneId: string | null
  scanPreset: ScanPreset
}

export interface ZoneSummary {
  zoneId: string
  label: string
  totalVehicles: number
  counts: Record<VehicleClass, number>
}

export interface AnalysisSummary {
  startedAt: string
  endedAt: string
  analyzerKind: AnalyzerKind
  totalVehicles: number
  counts: Record<VehicleClass, number>
  fileName: string
  zoneSummaries: ZoneSummary[]
}
