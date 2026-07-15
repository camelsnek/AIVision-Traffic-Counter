import type { AnalysisProgress, AnalysisStatus } from '../hooks/useTrafficAnalysis'
import { getPreprocessingProfile } from '../lib/framePreprocessing'
import { getModelProfile } from '../lib/modelProfiles'
import type { EngineInfo, PreprocessingProfileId } from '../types'

const statusLabels: Record<AnalysisStatus, string> = {
  idle: 'Load a video',
  ready: 'Ready',
  loading: 'Loading model…',
  running: 'Analyzing…',
  paused: 'Paused',
  stopped: 'Stopped',
  complete: 'Complete',
  error: 'Error',
}

interface TopBarProps {
  status: AnalysisStatus
  engine: EngineInfo | null
  preprocessingProfileId: PreprocessingProfileId
  progress: AnalysisProgress
}

export function TopBar({ status, engine, preprocessingProfileId, progress }: TopBarProps) {
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
            <span className="stat" title="Rolling completed-sample rate over up to 16 analysis completions">
              <span className="stat-value">{progress.throughputFps.toFixed(1)}</span> analysis fps
            </span>
            <span className="stat" title="Crop, pixel readback, image preprocessing, and tensor construction">
              <span className="stat-value">
                {Math.round(
                  progress.timings.detector.captureMs +
                    progress.timings.detector.preprocessingMs +
                    progress.timings.detector.tensorMs,
                )}
              </span>{' '}
              ms prep
            </span>
            <span className="stat" title="Measured detector work, excluding intentional prepared-frame queue time">
              <span className="stat-value">{Math.round(progress.timings.detector.totalMs)}</span> ms detector
            </span>
            <span className="stat" title="ONNX model execution only">
              <span className="stat-value">{Math.round(progress.timings.detector.inferenceMs)}</span> ms ONNX
            </span>
            <span className="stat" title="Precise video seek/decode with up to two immutable frames prepared ahead">
              <span className="stat-value">{Math.round(progress.timings.seekMs)}</span> ms seek
            </span>
          </div>
        )}
        {engine !== null && (
          <span className="chip chip-engine">
            {getModelProfile(engine.modelProfileId).label} · {engine.device === 'webgpu' ? 'GPU' : 'CPU'} ·{' '}
            {engine.dtype}
          </span>
        )}
        {preprocessingProfileId !== 'standard-v1' && (
          <span className="chip chip-engine">{getPreprocessingProfile(preprocessingProfileId).label} processing</span>
        )}
        <span className="chip chip-status" role="status" data-status={status}>
          <span className="chip-dot" aria-hidden="true" />
          {statusLabels[status]}
        </span>
      </div>
    </header>
  )
}
