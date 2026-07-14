import { useRef, useState } from 'react'
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  ReactNode,
  RefObject,
} from 'react'

import type { AnalysisProgress, AnalysisStatus, VideoSize } from '../hooks/useTrafficAnalysis'
import { formatDuration } from '../lib/format'

interface VideoStageProps {
  videoRef: RefObject<HTMLVideoElement | null>
  overlayRef: RefObject<HTMLCanvasElement | null>
  videoUrl: string | null
  fileName: string | null
  videoSize: VideoSize | null
  status: AnalysisStatus
  progress: AnalysisProgress
  loadFile(file: File): void
  /** Zone-editor layer, stacked above the overlay canvas. */
  children?: ReactNode
}

export function VideoStage({
  videoRef,
  overlayRef,
  videoUrl,
  fileName,
  videoSize,
  status,
  progress,
  loadFile,
  children,
}: VideoStageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const busy = status === 'running' || status === 'loading'

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (file) {
      loadFile(file)
    }
    event.currentTarget.value = ''
  }

  const handleDragOver = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files[0]
    if (file && (file.type === '' || file.type.startsWith('video/'))) {
      loadFile(file)
    }
  }

  return (
    <div className="card stage-shell">
      {videoUrl === null ? (
        <button
          type="button"
          className={dragActive ? 'dropzone is-drag' : 'dropzone'}
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
          </svg>
          <span className="dropzone-title">Drop a traffic video here</span>
          <span className="dropzone-hint">or click to browse</span>
          <span className="dropzone-note">MP4, MOV, WebM — processed locally, nothing uploads</span>
        </button>
      ) : (
        <>
          <div
            className="stage"
            style={{ aspectRatio: videoSize ? `${videoSize.width} / ${videoSize.height}` : '16 / 9' }}
          >
            <video ref={videoRef} className="stage-video" src={videoUrl} playsInline preload="auto" muted />
            <canvas ref={overlayRef} className="stage-overlay" />
            {children}
          </div>
          <div className="stage-footer">
            <div className="progress-row">
              <div className={status === 'loading' ? 'progress-track is-loading' : 'progress-track'}>
                <div className="progress-fill" style={{ width: `${progress.progress * 100}%` }} />
              </div>
              <span className="progress-time">
                {formatDuration(progress.videoTime)} / {formatDuration(progress.durationSeconds)}
              </span>
            </div>
            <div className="stage-meta">
              <span className="file-name" title={fileName ?? undefined}>
                {fileName}
              </span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                Replace video
              </button>
            </div>
          </div>
        </>
      )}
      <input ref={inputRef} type="file" accept="video/*" hidden onChange={handleFileInput} />
    </div>
  )
}
