import type { AnalysisStatus } from '../hooks/useTrafficAnalysis'

interface ActionBarProps {
  status: AnalysisStatus
  canStart: boolean
  hasVideo: boolean
  connected: boolean
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): void
  reset(): void
}

export function ActionBar({ status, canStart, hasVideo, connected, start, pause, resume, stop, reset }: ActionBarProps) {
  const active = status === 'running' || status === 'paused' || status === 'loading'
  const finished = status === 'complete' || status === 'stopped' || status === 'error'
  const hint = !connected
    ? 'Start the AIVision engine to analyse videos.'
    : !hasVideo
      ? 'Add a video to begin.'
      : null

  return (
    <div className="actions">
      {active ? (
        <div className="action-row">
          <button
            type="button"
            className="btn"
            disabled={status === 'loading'}
            onClick={status === 'paused' ? resume : pause}
          >
            {status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn btn-danger" disabled={status === 'loading'} onClick={stop}>
            Stop
          </button>
        </div>
      ) : (
        <div className="action-row">
          <button type="button" className="btn btn-primary" disabled={!canStart} onClick={() => void start()}>
            {finished ? 'Count again' : 'Start counting'}
          </button>
          {finished && (
            <button type="button" className="btn" onClick={reset}>
              Clear results
            </button>
          )}
        </div>
      )}
      {hint && <p className="action-hint">{hint}</p>}
    </div>
  )
}
