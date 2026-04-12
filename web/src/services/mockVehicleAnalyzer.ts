import type { AnalysisConfig, DetectionBox } from '../types'

import type { VehicleAnalyzer } from './vehicleAnalyzer'

export class MockVehicleAnalyzer implements VehicleAnalyzer {
  readonly kind = 'mock' as const
  private tick = 0

  async initialize(config: AnalysisConfig) {
    void config
    this.tick = 0
  }

  updateConfig(config: AnalysisConfig) {
    void config
  }

  async analyze() {
    this.tick += 1

    return [
      {
        vehicleClass: 'car',
        confidence: 0.92,
        left: 0.14,
        top: ((this.tick % 18) / 18) * 0.8,
        width: 0.19,
        height: 0.11,
      },
      {
        vehicleClass: 'truck',
        confidence: 0.89,
        left: 0.5,
        top: (((this.tick + 7) % 22) / 22) * 0.78,
        width: 0.23,
        height: 0.16,
      },
      ...(this.tick % 2 === 0
        ? [
            {
              vehicleClass: 'motorcycle' as const,
              confidence: 0.76,
              left: 0.74,
              top: (((this.tick + 12) % 28) / 28) * 0.76,
              width: 0.09,
              height: 0.08,
            },
          ]
        : []),
    ] satisfies DetectionBox[]
  }
}
