import type { AnalysisConfig, DetectionBox, DetectionRegion } from '../types'

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

  async analyze(_source: CanvasImageSource, region: DetectionRegion) {
    void _source
    this.tick += 1

    return [
      {
        vehicleClass: 'car',
        confidence: 0.92,
        left: region.left + region.width * 0.14,
        top: region.top + (((this.tick % 18) / 18) * region.height * 0.8),
        width: region.width * 0.19,
        height: region.height * 0.11,
      },
      {
        vehicleClass: 'truck',
        confidence: 0.89,
        left: region.left + region.width * 0.5,
        top: region.top + ((((this.tick + 7) % 22) / 22) * region.height * 0.78),
        width: region.width * 0.23,
        height: region.height * 0.16,
      },
      ...(this.tick % 2 === 0
        ? [
            {
              vehicleClass: 'motorcycle' as const,
              confidence: 0.76,
              left: region.left + region.width * 0.74,
              top: region.top + ((((this.tick + 12) % 28) / 28) * region.height * 0.76),
              width: region.width * 0.09,
              height: region.height * 0.08,
            },
          ]
        : []),
    ] satisfies DetectionBox[]
  }
}
