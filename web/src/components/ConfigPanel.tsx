import { useId } from 'react'

import { getModelProfile, modelProfiles } from '../lib/modelProfiles'
import type { AnalysisConfig, ModelProfileId } from '../types'

interface ConfigPanelProps {
  config: AnalysisConfig
  /** Config is captured when a run starts, so inputs lock while busy. */
  disabled: boolean
  setModelProfile(modelProfileId: ModelProfileId): void
  setConfidence(confidence: number): void
  setSamplingFps(samplingFps: number): void
}

export function ConfigPanel({
  config,
  disabled,
  setModelProfile,
  setConfidence,
  setSamplingFps,
}: ConfigPanelProps) {
  const modelId = useId()
  const confidenceId = useId()
  const samplingId = useId()
  const confidencePct = ((config.confidence - 0.2) / 0.4) * 100
  const samplingPct = ((config.samplingFps - 5) / 10) * 100

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
      </div>
    </section>
  )
}
