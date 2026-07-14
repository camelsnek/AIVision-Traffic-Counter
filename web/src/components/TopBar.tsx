import type { AnalysisProgress, AnalysisStatus } from '../hooks/useTrafficAnalysis'
import { getModelProfile } from '../lib/modelProfiles'
import type { EngineInfo } from '../types'

const statusLabels: Record<AnalysisStatus, string> = {
  idle: 'Load a video',
  ready: 'Ready',
  loading: 'Loading model…',
  running: 'Analyzing…',
  stopped: 'Stopped',
  complete: 'Complete',
  error: 'Error',
}

interface TopBarProps {
  status: AnalysisStatus
  engine: EngineInfo | null
  progress: AnalysisProgress
}

export function TopBar({ status, engine, progress }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.5" />
          <line
            x1="4.5"
            y1="12.5"
            x2="15.5"
            y2="12.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="2.6 2.2"
          />
          <circle cx="10" cy="7" r="2.2" fill="currentColor" />
        </svg>
        <h1 className="brand-name">AIVision Traffic Counter</h1>
      </div>
      <div className="topbar-status">
        {status === 'running' && (
          <div className="live-stats">
            <span className="stat">
              <span className="stat-value">{progress.throughputFps.toFixed(1)}</span> fps
            </span>
            <span className="stat">
              <span className="stat-value">{Math.round(progress.inferenceMs)}</span> ms/frame
            </span>
          </div>
        )}
        {engine !== null && (
          <span className="chip chip-engine">
            {getModelProfile(engine.modelProfileId).label} · {engine.device.toUpperCase()} · {engine.dtype}
          </span>
        )}
        <span className="chip chip-status" role="status" data-status={status}>
          <span className="chip-dot" aria-hidden="true" />
          {statusLabels[status]}
        </span>
      </div>
    </header>
  )
}
