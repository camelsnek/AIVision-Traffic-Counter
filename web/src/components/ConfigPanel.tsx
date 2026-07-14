import { useId } from 'react'

import { getModelProfile, modelProfiles } from '../lib/modelProfiles'
import type { AnalysisConfig, EnginePreference, ModelProfileId } from '../types'

interface ConfigPanelProps {
  config: AnalysisConfig
  /** Config is captured when a run starts, so inputs lock while busy. */
  disabled: boolean
  gpuAvailable: boolean | null
  setModelProfile(modelProfileId: ModelProfileId): void
  setEnginePreference(preference: EnginePreference): void
  setConfidence(confidence: number): void
  setSamplingFps(samplingFps: number): void
}

export function ConfigPanel({
  config,
  disabled,
  gpuAvailable,
  setModelProfile,
  setEnginePreference,
  setConfidence,
  setSamplingFps,
}: ConfigPanelProps) {
  const modelId = useId()
  const engineId = useId()
  const confidenceId = useId()
  const samplingId = useId()
  const confidencePct = ((config.confidence - 0.2) / 0.4) * 100
  const samplingPct = ((config.samplingFps - 5) / 10) * 100
  const engineHint =
    gpuAvailable === null
      ? 'Checking browser GPU support…'
      : config.enginePreference === 'gpu'
        ? 'Uses WebGPU with the high-performance adapter. Best throughput when supported.'
        : config.enginePreference === 'cpu'
          ? 'Uses the quantized model on WebAssembly. Most compatible, but usually slower.'
          : gpuAvailable
            ? 'WebGPU is available. Auto uses the GPU and falls back to CPU if initialization fails.'
            : 'WebGPU is unavailable in this browser. Auto will use the CPU/WASM runtime.'

  return (
    <section className="card" aria-label="Analysis configuration">
      <header className="card-head">
        <h2 className="card-title">Configuration</h2>
      </header>
      <div className="field">
        <div className="field-head">
          <label htmlFor={modelId}>Detection model</label>
        </div>
        <select
          id={modelId}
          className="select"
          value={config.modelProfileId}
          disabled={disabled}
          onChange={(event) => {
            const profile = modelProfiles.find((candidate) => candidate.id === event.target.value)
            if (profile) {
              setModelProfile(profile.id)
            }
          }}
        >
          {modelProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
        <p className="field-hint">{getModelProfile(config.modelProfileId).description}</p>
      </div>
      <div className="field">
        <div className="field-head">
          <label htmlFor={engineId}>Processing device</label>
        </div>
        <select
          id={engineId}
          className="select"
          value={config.enginePreference}
          disabled={disabled}
          onChange={(event) => {
            const preference = event.target.value
            if (preference === 'auto' || preference === 'gpu' || preference === 'cpu') {
              setEnginePreference(preference)
            }
          }}
        >
          <option value="auto">Auto — prefer GPU</option>
          <option value="gpu" disabled={gpuAvailable === false}>
            GPU — WebGPU{gpuAvailable === false ? ' (unavailable)' : ''}
          </option>
          <option value="cpu">CPU — WebAssembly</option>
        </select>
        <p className="field-hint">{engineHint}</p>
      </div>
      <div className="field">
        <div className="field-head">
          <label htmlFor={confidenceId}>Confidence</label>
          <span className="field-value">{config.confidence.toFixed(2)}</span>
        </div>
        <input
          id={confidenceId}
          className="range"
          type="range"
          min={0.2}
          max={0.6}
          step={0.05}
          value={config.confidence}
          disabled={disabled}
          style={{
            backgroundImage: `linear-gradient(to right, var(--accent) ${confidencePct}%, var(--bg-3) ${confidencePct}%)`,
          }}
          onChange={(event) => setConfidence(event.currentTarget.valueAsNumber)}
        />
      </div>
      <div className="field">
        <div className="field-head">
          <label htmlFor={samplingId}>Sampling rate</label>
          <span className="field-value">{config.samplingFps} fps of video time</span>
        </div>
        <input
          id={samplingId}
          className="range"
          type="range"
          min={5}
          max={15}
          step={1}
          value={config.samplingFps}
          disabled={disabled}
          style={{
            backgroundImage: `linear-gradient(to right, var(--accent) ${samplingPct}%, var(--bg-3) ${samplingPct}%)`,
          }}
          onChange={(event) => setSamplingFps(event.currentTarget.valueAsNumber)}
        />
        <p className="field-hint">Lower rates analyze fewer frames and finish sooner; 5 fps suits most road footage.</p>
      </div>
    </section>
  )
}
