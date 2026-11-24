import type { AnalysisStatus } from '../hooks/useTrafficAnalysis'
import type { ModelInfo } from '../lib/api'
import type { EngineInfo } from '../types'

const statusLabels: Record<AnalysisStatus, string> = {
  idle: 'No video',
  uploading: 'Uploading',
  ready: 'Ready',
  loading: 'Loading model',
  running: 'Counting',
  paused: 'Paused',
  stopped: 'Stopped',
  complete: 'Finished',
  error: 'Error',
}

interface AppHeaderProps {
  connected: boolean
  status: AnalysisStatus
  engine: EngineInfo | null
  models: ModelInfo[]
}

export function AppHeader({ connected, status, engine, models }: AppHeaderProps) {
  const modelLabel = engine ? (models.find((model) => model.id === engine.modelId)?.label ?? engine.modelId) : null
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="1" y="1" width="24" height="24" rx="5" fill="var(--marking)" />
          <path d="M5 17h16" stroke="var(--asphalt-0)" strokeWidth="2.2" strokeDasharray="3.2 2.4" />
          <rect x="9.5" y="6" width="7" height="8" rx="1.8" fill="var(--asphalt-0)" />
        </svg>
        <h1>AIVision traffic counter</h1>
      </div>
      <div className="topbar-right">
        {engine && (
          <span className="engine-tag" title={engine.fallbacks ? `Fallbacks: ${engine.fallbacks}` : undefined}>
            {modelLabel} on {engine.provider} <span className="engine-precision">{engine.precision}</span>
          </span>
        )}
        <span className={connected ? 'link-state is-up' : 'link-state'}>
          {connected ? 'Engine connected' : 'Engine offline'}
        </span>
        <span className="status-tag" data-status={status} role="status">
          {statusLabels[status]}
        </span>
      </div>
    </header>
  )
}
