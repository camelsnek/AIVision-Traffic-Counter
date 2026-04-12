import type { AnalysisConfig, AnalyzerKind, DetectionBox } from '../types'

export interface VehicleAnalyzer {
  readonly kind: AnalyzerKind
  initialize(config: AnalysisConfig): Promise<void>
  updateConfig(config: AnalysisConfig): void
  analyze(source: CanvasImageSource): Promise<DetectionBox[]>
}
