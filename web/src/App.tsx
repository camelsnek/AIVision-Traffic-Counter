import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import { ResultsPanel } from './components/ResultsPanel'
import { VideoStage } from './components/VideoStage'
import { drawOverlay } from './lib/drawOverlay'
import { formatDuration } from './lib/format'
import { VehicleTracker } from './lib/vehicleTracker'
import type { VehicleAnalyzer } from './services/vehicleAnalyzer'
import { vehicleClasses, type AnalysisConfig, type AnalysisSummary, type VehicleClass, type TrackedVehicle } from './types'
import './App.css'

function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [selectedFileName, setSelectedFileName] = useState('No file selected')
  const [status, setStatus] = useState('Choose a road video to begin')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analyzerLabel, setAnalyzerLabel] = useState('Not initialized')
  const [tracks, setTracks] = useState<TrackedVehicle[]>([])
  const [counts, setCounts] = useState<Record<VehicleClass, number>>(createEmptyCounts)
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [showRegionEditor, setShowRegionEditor] = useState(false)
  const [config, setConfig] = useState<AnalysisConfig>({
    confidenceThreshold: 0.25,
    frameStride: 1,
    countingLinePosition: 0.52,
    detectionRegion: {
      left: 0.08,
      top: 0.2,
      width: 0.84,
      height: 0.72,
    },
    scanPreset: 'balanced',
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const analyzerRef = useRef<VehicleAnalyzer | null>(null)
  const trackerRef = useRef(new VehicleTracker())
  const rafRef = useRef<number | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const sessionStartRef = useRef<number | null>(null)
  const frameIndexRef = useRef(0)
  const countsRef = useRef<Record<VehicleClass, number>>(createEmptyCounts())
  const isRunningRef = useRef(false)
  const analysisInFlightRef = useRef(false)
  const usingVideoFrameCallbackRef = useRef(false)
  const overlayFramePendingRef = useRef(false)

  const deferredTracks = useDeferredValue(tracks)
  const deferredCounts = useDeferredValue(counts)

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay) {
      return
    }
    if (overlayFramePendingRef.current) {
      return
    }
    overlayFramePendingRef.current = true
    requestAnimationFrame(() => {
      drawOverlay(overlay, video, deferredTracks, config.countingLinePosition)
      overlayFramePendingRef.current = false
    })
  }, [config.countingLinePosition, deferredTracks, videoUrl])

  useEffect(() => {
    if (!isRunningRef.current) {
      return
    }

    const intervalId = window.setInterval(() => {
      const startedAt = sessionStartRef.current
      if (startedAt == null) {
        return
      }
      setElapsedSeconds((getNowMs() - startedAt) / 1000)
      setCurrentTime(videoRef.current?.currentTime ?? 0)
    }, 250)

    return () => window.clearInterval(intervalId)
  }, [status])

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    const nextUrl = URL.createObjectURL(file)
    objectUrlRef.current = nextUrl
    setVideoUrl(nextUrl)
    setSelectedFileName(file.name)
    setStatus('Video loaded. Ready to scan.')
    setErrorMessage(null)
    setSummary(null)
    resetSessionState()
  }

  async function startAnalysis() {
    const video = videoRef.current
    if (!video || !videoUrl) {
      return
    }

    stopLoop()
    setErrorMessage(null)
    setSummary(null)
    setStatus('Initializing analyzer...')
    resetSessionState()

    try {
      const analyzer = await initializeAnalyzer(config)
      analyzerRef.current = analyzer
      setAnalyzerLabel(`YOLOv10n ${config.scanPreset}`)

      video.currentTime = 0
      sessionStartRef.current = getNowMs()
      isRunningRef.current = true
      analysisInFlightRef.current = false
      setStatus('Scanning vehicles...')
      await video.play()
      scheduleNextAnalysisFrame(video, analyzer)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to initialize analyzer.')
      setStatus('Analyzer setup failed')
      isRunningRef.current = false
    }
  }

  function stopAnalysis(nextStatus = 'Analysis stopped') {
    const video = videoRef.current
    isRunningRef.current = false
    analysisInFlightRef.current = false
    stopLoop()
    video?.pause()
    finalizeSummary(nextStatus)
  }

  function finalizeAnalysis() {
    const flush = trackerRef.current.flush(config.countingLinePosition)
    applyTrackingUpdate(flush.activeTracks, flush.newlyCountedClasses)
    isRunningRef.current = false
    stopLoop()
    finalizeSummary('Analysis complete')
  }

  function finalizeSummary(nextStatus: string) {
    const startedAt = sessionStartRef.current
    setStatus(nextStatus)
    setElapsedSeconds(startedAt ? (getNowMs() - startedAt) / 1000 : 0)
    setCurrentTime(videoRef.current?.currentTime ?? 0)

    if (!startedAt) {
      return
    }

    const analyzerKind = analyzerRef.current?.kind ?? 'mock'
    const totalVehicles = Object.values(countsRef.current).reduce((sum, count) => sum + count, 0)
    setSummary({
      startedAt: new Date(startedAt).toISOString(),
      endedAt: getIsoNow(),
      analyzerKind,
      totalVehicles,
      counts: { ...countsRef.current },
      fileName: selectedFileName,
    })
  }

  function resetAll() {
    stopLoop()
    isRunningRef.current = false
    analysisInFlightRef.current = false
    videoRef.current?.pause()
    if (videoRef.current) {
      videoRef.current.currentTime = 0
    }
    setSummary(null)
    setStatus(videoUrl ? 'Video loaded. Ready to scan.' : 'Choose a road video to begin')
    setErrorMessage(null)
    resetSessionState()
  }

  function applyTrackingUpdate(nextTracks: TrackedVehicle[], newlyCountedClasses: VehicleClass[]) {
    const nextCounts = { ...countsRef.current }
    for (const vehicleClass of newlyCountedClasses) {
      nextCounts[vehicleClass] += 1
    }
    countsRef.current = nextCounts

    startTransition(() => {
      setTracks(nextTracks)
      setCounts(nextCounts)
    })
  }

  function resetSessionState() {
    trackerRef.current.reset()
    frameIndexRef.current = 0
    sessionStartRef.current = null
    countsRef.current = createEmptyCounts()
    setCounts(createEmptyCounts())
    setTracks([])
    setElapsedSeconds(0)
    setCurrentTime(0)
  }

  function stopLoop() {
    if (rafRef.current != null) {
      if (usingVideoFrameCallbackRef.current && videoRef.current?.cancelVideoFrameCallback) {
        videoRef.current.cancelVideoFrameCallback(rafRef.current)
      } else {
        cancelAnimationFrame(rafRef.current)
      }
      rafRef.current = null
    }
    usingVideoFrameCallbackRef.current = false
  }

  function scheduleNextAnalysisFrame(video: HTMLVideoElement, analyzer: VehicleAnalyzer) {
    if (!isRunningRef.current) {
      return
    }

    const processFrame = async () => {
      if (!isRunningRef.current) {
        return
      }

      if (video.ended) {
        finalizeAnalysis()
        return
      }

      if (video.paused) {
        scheduleNextAnalysisFrame(video, analyzer)
        return
      }

      frameIndexRef.current += 1
      const shouldAnalyze = frameIndexRef.current % config.frameStride === 0

      if (shouldAnalyze && !analysisInFlightRef.current) {
        analysisInFlightRef.current = true
        try {
          analyzer.updateConfig(config)
          const detections = await analyzer.analyze(video)
          const update = trackerRef.current.update(detections, config.countingLinePosition)
          applyTrackingUpdate(update.activeTracks, update.newlyCountedClasses)
          startTransition(() => {
            setCurrentTime(video.currentTime)
          })
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : 'Analysis failed.')
          stopAnalysis('Analysis stopped because the browser model failed.')
          return
        } finally {
          analysisInFlightRef.current = false
        }
      }

      scheduleNextAnalysisFrame(video, analyzer)
    }

    if (video.requestVideoFrameCallback) {
      usingVideoFrameCallbackRef.current = true
      rafRef.current = video.requestVideoFrameCallback(() => {
        void processFrame()
      })
      return
    }

    usingVideoFrameCallbackRef.current = false
    rafRef.current = requestAnimationFrame(() => {
      void processFrame()
    })
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">RoadScope Web</p>
          <h1>Drop in a traffic video and scan passing vehicles in the browser.</h1>
          <p className="hero-description">
            This React app mirrors the mobile flow: upload a local road clip, run detection frame by frame,
            track each vehicle once, and keep live totals for the session.
          </p>
        </div>
        <div className="hero-stats">
          <div>
            <span>Engine</span>
            <strong>{analyzerLabel}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{status}</strong>
          </div>
          <div>
            <span>Current file</span>
            <strong>{selectedFileName}</strong>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="workspace-main">
          <div className="control-card">
            <div className="section-heading">
              <h2>Upload & Scan</h2>
              <span>{videoUrl ? 'Video loaded' : 'Waiting for a file'}</span>
            </div>

            <label className="upload-field">
              <input type="file" accept="video/*" onChange={(event) => void handleFileChange(event)} />
              <span>Choose Video</span>
              <small>MP4, MOV, or another browser-playable video file</small>
            </label>

            <div className="control-grid">
              <label>
                <span>Confidence {config.confidenceThreshold.toFixed(2)}</span>
                <input
                  type="range"
                  min="0.2"
                  max="0.9"
                  step="0.05"
                  value={config.confidenceThreshold}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      confidenceThreshold: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>Frame Stride {config.frameStride}</span>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={config.frameStride}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      frameStride: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>Count Line {Math.round(config.countingLinePosition * 100)}%</span>
                <input
                  type="range"
                  min="0.35"
                  max="0.9"
                  step="0.01"
                  value={config.countingLinePosition}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      countingLinePosition: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>Scan Preset</span>
                <select
                  value={config.scanPreset}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      scanPreset: event.target.value as AnalysisConfig['scanPreset'],
                      frameStride: event.target.value === 'fast' ? 2 : 1,
                    }))
                  }
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="dense">Dense Traffic</option>
                </select>
              </label>
            </div>

            <div className="button-row">
              <button className="primary-button" type="button" onClick={() => void startAnalysis()} disabled={!videoUrl}>
                Start Scan
              </button>
              <button className="secondary-button" type="button" onClick={() => stopAnalysis()} disabled={!videoUrl}>
                Stop
              </button>
              <button className="ghost-button" type="button" onClick={resetAll}>
                Reset
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowRegionEditor((current) => !current)}
                disabled={!videoUrl}
              >
                {showRegionEditor ? 'Lock Zone' : 'Edit Zone'}
              </button>
            </div>

            <div className="class-strip">
              {vehicleClasses.map((vehicleClass) => (
                <span key={vehicleClass}>{vehicleClass}</span>
              ))}
            </div>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
            <p className="helper-copy">
              This web build uses a real locally downloaded YOLOv10n detector from
              <code> /public/models/onnx-community/yolov10n </code> and reports only
              <code> car</code>, <code>truck</code>, <code>bus</code>, and <code>motorcycle</code>.
            </p>
            <p className="helper-copy">
              Use <code>Edit Zone</code> to drag the detection box over the active lanes only. Smaller zones scan
              faster, render smoother, and usually count better than analyzing the whole frame.
            </p>
          </div>

          <VideoStage
            videoRef={videoRef}
            overlayRef={overlayRef}
            videoUrl={videoUrl}
            statusLabel={`${status} • ${formatDuration(currentTime)} video time`}
            detectionRegion={config.detectionRegion}
            showRegionEditor={showRegionEditor}
            onDetectionRegionChange={(detectionRegion) =>
              setConfig((current) => ({
                ...current,
                detectionRegion,
              }))
            }
          />
        </div>

        <ResultsPanel
          summary={summary}
          counts={deferredCounts}
          analyzerLabel={analyzerLabel}
          elapsedSeconds={elapsedSeconds}
          currentTime={currentTime}
        />
      </section>
    </main>
  )
}

export default App

async function initializeAnalyzer(config: AnalysisConfig) {
  const { OnnxVehicleAnalyzer } = await import('./services/onnxVehicleAnalyzer')
  const analyzer = new OnnxVehicleAnalyzer(config)
  await analyzer.initialize(config)
  return analyzer
}

function createEmptyCounts() {
  return {
    car: 0,
    truck: 0,
    bus: 0,
    motorcycle: 0,
  } satisfies Record<VehicleClass, number>
}

function getNowMs() {
  return Date.now()
}

function getIsoNow() {
  return new Date().toISOString()
}
