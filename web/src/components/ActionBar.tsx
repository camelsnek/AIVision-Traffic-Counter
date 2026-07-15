import type { AnalysisStatus } from '../hooks/useTrafficAnalysis'

interface ActionBarProps {
  status: AnalysisStatus
  canStart: boolean
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): void
  reset(): void
}

export function ActionBar({ status, canStart, start, pause, resume, stop, reset }: ActionBarProps) {
  const finished = status === 'complete' || status === 'stopped' || status === 'error'
  return (
    <div className="action-row">
      <button type="button" className="btn btn-primary" disabled={!canStart} onClick={() => void start()}>
        {finished ? 'Restart analysis' : 'Start analysis'}
      </button>
      <button
        type="button"
        className="btn"
        disabled={status !== 'running' && status !== 'paused'}
        onClick={status === 'paused' ? resume : pause}
      >
        {status === 'paused' ? 'Resume' : 'Pause'}
      </button>
      <button
        type="button"
        className="btn"
        disabled={status !== 'running' && status !== 'paused'}
        onClick={stop}
      >
        Stop
      </button>
      <button type="button" className="btn" disabled={status === 'idle'} onClick={reset}>
        Reset
      </button>
    </div>
  )
}
