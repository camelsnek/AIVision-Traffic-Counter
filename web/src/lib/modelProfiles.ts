import type { ModelProfileId } from '../types'

export interface ModelProfile {
  id: ModelProfileId
  label: string
  description: string
}

export const modelProfiles: ModelProfile[] = [
  {
    id: 'onnx-community/yolov10n',
    label: 'YOLOv10n Fast',
    description: 'Lightweight model for faster scans and lower browser load.',
  },
  {
    id: 'onnx-community/yolov10m',
    label: 'YOLOv10m Dense',
    description: 'Heavier model with better recall when traffic is packed or vehicles are small.',
  },
]

export function getModelProfile(modelProfileId: ModelProfileId) {
  return modelProfiles.find((profile) => profile.id === modelProfileId) ?? modelProfiles[0]
}
