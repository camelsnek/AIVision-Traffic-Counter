import { useId } from 'react'

import type { ModelInfo } from '../lib/api'
import type { AnalysisConfig, DevicePreference } from '../types'

const samplingOptions = [
  { value: 0, label: 'Every frame', hint: 'Most precise. Recommended with a GPU.' },
  { value: 15, label: '15 per second', hint: 'Good for fast roads on slower machines.' },
  { value: 10, label: '10 per second', hint: 'Fine for city traffic.' },
  { value: 5, label: '5 per second', hint: 'Quick previews only; fast vehicles may be missed.' },
] as const

interface ConfigPanelProps {
  config: AnalysisConfig
  models: ModelInfo[]
  gpuAvailable: boolean | null
  providers: string[]
  /** Settings are captured when a run starts, so inputs lock while busy. */
  disabled: boolean
  setModel(modelId: string): void
  setDevice(device: DevicePreference): void
  setConfidence(confidence: number): void
  setSamplingFps(samplingFps: number): void
}

export function ConfigPanel({
  config,
  models,
  gpuAvailable,
  providers,
  disabled,
  setModel,
  setDevice,
  setConfidence,
  setSamplingFps,
}: ConfigPanelProps) {
  const modelId = useId()
  const deviceId = useId()
  const confidenceId = useId()
  const samplingId = useId()
  const model = models.find((candidate) => candidate.id === config.modelId)
  const sampling = samplingOptions.find((option) => option.value === config.samplingFps) ?? samplingOptions[0]
  const gpuName = providers.includes('TensorrtExecutionProvider')
    ? 'NVIDIA GPU with TensorRT'
    : providers.includes('CUDAExecutionProvider')
      ? 'NVIDIA GPU with CUDA'
      : providers.includes('DmlExecutionProvider')
        ? 'GPU with DirectML'
        : null

  return (
    <section className="panel" aria-label="Settings">
      <header className="panel-head">
        <h2>Settings</h2>
      </header>

      <div className="field">
        <label htmlFor={modelId}>Detection model</label>
        <select
          id={modelId}
          className="select"
          value={config.modelId}
          disabled={disabled || models.length === 0}
          onChange={(event) => setModel(event.target.value)}
        >
          {models.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        {model && <p className="field-hint">{model.description}</p>}
      </div>

      <div className="field">
        <label htmlFor={deviceId}>Hardware</label>
        <select
          id={deviceId}
          className="select"
          value={config.device}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'auto' || value === 'gpu' || value === 'cpu') {
              setDevice(value)
            }
          }}
        >
          <option value="auto">Automatic</option>
          <option value="gpu" disabled={gpuAvailable === false}>
            GPU only{gpuAvailable === false ? ' (not available)' : ''}
          </option>
          <option value="cpu">CPU only</option>
        </select>
        <p className="field-hint">
          {gpuName ? `Found ${gpuName}.` : gpuAvailable === null ? 'Checking hardware…' : 'No GPU found; the CPU will be used.'}
        </p>
      </div>

      <div className="field">
        <label htmlFor={samplingId}>Frames to analyse</label>
        <select
          id={samplingId}
          className="select"
          value={config.samplingFps}
          disabled={disabled}
          onChange={(event) => setSamplingFps(Number(event.target.value))}
        >
          {samplingOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="field-hint">{sampling.hint}</p>
      </div>

      <div className="field">
        <div className="field-row">
          <label htmlFor={confidenceId}>Detection confidence</label>
          <output htmlFor={confidenceId}>{Math.round(config.confidence * 100)} %</output>
        </div>
        <input
          id={confidenceId}
          className="range"
          type="range"
          min={0.2}
          max={0.7}
          step={0.05}
          value={config.confidence}
          disabled={disabled}
          style={{ ['--fill' as string]: `${((config.confidence - 0.2) / 0.5) * 100}%` }}
          onChange={(event) => setConfidence(event.currentTarget.valueAsNumber)}
        />
        <p className="field-hint">Lower finds more distant vehicles but risks false counts.</p>
      </div>
    </section>
  )
}
