import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent as ReactDragEvent, ReactNode, RefObject } from 'react'

import type { AnalysisProgress, AnalysisStatus, VideoSize } from '../hooks/useTrafficAnalysis'
import { api, type VideoMeta } from '../lib/api'
import { formatDuration } from '../lib/format'

interface VideoStageProps {
  frameRef: RefObject<HTMLImageElement | null>
  overlayRef: RefObject<HTMLCanvasElement | null>
  video: VideoMeta | null
  videoSize: VideoSize | null
  status: AnalysisStatus
  progress: AnalysisProgress
  uploadProgress: number | null
  loadFile(file: File): Promise<void>
  /** Zone-editor layer, stacked above the overlay canvas. */
  children?: ReactNode
}

export function VideoStage({
  frameRef,
  overlayRef,
  video,
  videoSize,
  status,
  progress,
  uploadProgress,
  loadFile,
  children,
}: VideoStageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (file) {
      void loadFile(file)
    }
    event.currentTarget.value = ''
  }

  const dragProps = {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      setDragActive(true)
    },
    onDragLeave: () => setDragActive(false),
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      setDragActive(false)
      const file = event.dataTransfer.files[0]
      if (file) {
        void loadFile(file)
      }
    },
  }

  const running = status === 'running' || status === 'paused' || status === 'loading'
  const timings = progress.timings
  const performance = progress.performance

  return (
    <div className="stage-shell">
      {video === null ? (
        <button
          type="button"
          className={dragActive ? 'dropzone is-drag' : 'dropzone'}
          onClick={() => inputRef.current?.click()}
          disabled={status === 'uploading'}
          {...dragProps}
        >
          {status === 'uploading' ? (
            <>
              <span className="dropzone-title">Uploading video</span>
              <span className="upload-meter" aria-hidden="true">
                <span style={{ width: `${(uploadProgress ?? 0) * 100}%` }} />
              </span>
              <span className="dropzone-hint">{Math.round((uploadProgress ?? 0) * 100)} %</span>
            </>
          ) : (
            <>
              <span className="dropzone-title">Drop a traffic video here</span>
              <span className="dropzone-hint">or click to choose a file. MP4, MOV, MKV, AVI and TS work.</span>
              <span className="dropzone-note">The file is stored by the local AIVision engine and never leaves this machine.</span>
            </>
          )}
        </button>
      ) : (
        <div
          className="stage"
          style={{ aspectRatio: videoSize ? `${videoSize.width} / ${videoSize.height}` : '16 / 9' }}
          {...dragProps}
        >
          <img ref={frameRef} className="stage-frame" src={api.posterUrl(video.id)} alt="" draggable={false} />
          <canvas ref={overlayRef} className="stage-overlay" />
          {children}
          {status === 'uploading' && (
            <div className="stage-veil">Uploading {Math.round((uploadProgress ?? 0) * 100)} %</div>
          )}
        </div>
      )}

      {video !== null && (
        <div className="telemetry">
          <div className="progress-track" data-active={running}>
            <span style={{ width: `${progress.progress * 100}%` }} />
          </div>
          <div className="telemetry-row">
            <span className="telemetry-file" title={video.name}>
              {video.name}
            </span>
            <span className="telemetry-time">
              {formatDuration(progress.videoTime)} / {formatDuration(video.durationSeconds)}
            </span>
          </div>
          <dl className="telemetry-stats">
            <div>
              <dt>Source</dt>
              <dd>
                {video.width}×{video.height}, {video.fps.toFixed(0)} fps
              </dd>
            </div>
            {running && (
              <>
                <div>
                  <dt>Analysis speed</dt>
                  <dd>{progress.throughputFps.toFixed(0)} fps</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{(timings.inferenceMs ?? 0).toFixed(1)} ms</dd>
                </div>
                <div>
                  <dt>Decode wait</dt>
                  <dd>{(timings.decodeMs ?? 0).toFixed(1)} ms</dd>
                </div>
              </>
            )}
            {!running && performance && (
              <>
                <div>
                  <dt>Analysed</dt>
                  <dd>
                    {performance.frames} frames in {performance.wallSeconds.toFixed(1)} s
                  </dd>
                </div>
                <div>
                  <dt>Average speed</dt>
                  <dd>
                    {performance.fps.toFixed(0)} fps, {performance.realtimeFactor.toFixed(1)}× real time
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>
      )}
      <input ref={inputRef} type="file" accept="video/*,.mkv,.ts,.mts" hidden onChange={handleFileInput} />
    </div>
  )
}
