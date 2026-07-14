import type { ModelProfileId } from '../types'

export interface ModelProfile {
  id: ModelProfileId
  label: string
  description: string
  /** Whether public/models contains a model_quantized.onnx for WASM. */
  hasQuantized: boolean
}

export const modelProfiles: ModelProfile[] = [
  {
    id: 'onnx-community/yolov10n',
    label: 'YOLOv10-N',
    description: 'Fast and light. Best default for most footage.',
    hasQuantized: true,
  },
  {
    id: 'onnx-community/yolov10m',
    label: 'YOLOv10-M',
    description: 'Heavier and more accurate for small or dense vehicles. Needs a fast machine.',
    hasQuantized: false,
  },
]

export function getModelProfile(modelProfileId: ModelProfileId): ModelProfile {
  return modelProfiles.find((profile) => profile.id === modelProfileId) ?? modelProfiles[0]
}
