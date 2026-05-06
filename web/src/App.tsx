import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import { ResultsPanel } from './components/ResultsPanel'
import { VideoStage } from './components/VideoStage'
import { drawOverlay } from './lib/drawOverlay'
import { formatDuration } from './lib/format'
import { getModelProfile, modelProfiles } from './lib/modelProfiles'
import { VehicleTracker } from './lib/vehicleTracker'
import type { VehicleAnalyzer } from './services/vehicleAnalyzer'
import {
  vehicleClasses,
  type AnalysisConfig,
  type AnalysisSummary,
  type DetectionRegion,
  type DetectionZone,
  type ModelProfileId,
  type TrackedVehicle,
  type VehicleClass,
  type ZoneSummary,
} from './types'
import './App.css'

const INITIAL_ZONES = createInitialZones()

function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [selectedFileName, setSelectedFileName] = useState('No file selected')
  const [status, setStatus] = useState('Choose a road video to begin')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analyzerLabel, setAnalyzerLabel] = useState('Not initialized')
  const [tracks, setTracks] = useState<TrackedVehicle[]>([])
  const [counts, setCounts] = useState<Record<VehicleClass, number>>(() => createEmptyCounts())
  const [zoneSummaries, setZoneSummaries] = useState<ZoneSummary[]>(() => createEmptyZoneSummaries(INITIAL_ZONES))
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [showRegionEditor, setShowRegionEditor] = useState(false)
  const [config, setConfig] = useState<AnalysisConfig>(() => ({
    modelProfileId: 'onnx-community/yolov10n',
    confidenceThreshold: 0.16,
    analysisIntervalMs: 25,
    detailLevel: 1,
    trackingBias: 2,
    scanPreset: 'fast',
    activeZoneId: INITIAL_ZONES[0]?.id ?? null,
    detectionZones: INITIAL_ZONES,
  }))

  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const analyzerRef = useRef<VehicleAnalyzer | null>(null)
  const configRef = useRef<AnalysisConfig>({
    modelProfileId: 'onnx-community/yolov10n',
    confidenceThreshold: 0.16,
    analysisIntervalMs: 25,
    detailLevel: 1,
    trackingBias: 2,
    scanPreset: 'fast',
    activeZoneId: INITIAL_ZONES[0]?.id ?? null,
    detectionZones: INITIAL_ZONES,
  })
  const trackerMapRef = useRef(new Map<string, VehicleTracker>())
  const rafRef = useRef<number | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const sessionStartRef = useRef<number | null>(null)
  const countsRef = useRef<Record<VehicleClass, number>>(createEmptyCounts())
  const zoneCountsRef = useRef<Record<string, Record<VehicleClass, number>>>(createZoneCountMap(INITIAL_ZONES))
  const isRunningRef = useRef(false)
  const analysisInFlightRef = useRef(false)
  const usingVideoFrameCallbackRef = useRef(false)
  const overlayFramePendingRef = useRef(false)
  const lastAnalyzedAtRef = useRef(0)
  const lastAnalyzedVideoTimeRef = useRef(-1)
  const analysisFrameRef = useRef<HTMLCanvasElement | null>(null)

  const deferredTracks = useDeferredValue(tracks)
  const deferredCounts = useDeferredValue(counts)
  const deferredZoneSummaries = useDeferredValue(zoneSummaries)

  useEffect(() => {
    configRef.current = config
  }, [config])

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
      drawOverlay(overlay, video, deferredTracks, config.detectionZones)
      overlayFramePendingRef.current = false
    })
  }, [config.detectionZones, deferredTracks, videoUrl])

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
    resetSessionState(configRef.current.detectionZones)
  }

  async function startAnalysis() {
    const video = videoRef.current
    const currentConfig = configRef.current
    if (!video || !videoUrl || currentConfig.detectionZones.length === 0) {
      return
    }

    stopLoop()
    setErrorMessage(null)
    setSummary(null)
    setStatus('Initializing analyzer...')
    resetSessionState(currentConfig.detectionZones)

    try {
      const initialized = await initializeAnalyzer(currentConfig)
      analyzerRef.current = initialized.analyzer
      if (initialized.config !== currentConfig) {
        configRef.current = initialized.config
        setConfig(initialized.config)
      }
      setAnalyzerLabel(`${getModelProfile(initialized.config.modelProfileId).label} ${initialized.config.scanPreset}`)

      video.currentTime = 0
      sessionStartRef.current = getNowMs()
      isRunningRef.current = true
      analysisInFlightRef.current = false
      setStatus(
        initialized.config.modelProfileId === currentConfig.modelProfileId
          ? 'Scanning vehicles...'
          : 'Dense model unavailable. Scanning with stable fast model...',
      )
      await video.play()
      scheduleNextAnalysisFrame(video, initialized.analyzer)
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
    const currentConfig = configRef.current
    const nextZoneCounts = cloneZoneCountMap(zoneCountsRef.current)
    const overlayTracks: TrackedVehicle[] = []

    for (const zone of currentConfig.detectionZones) {
      const tracker = trackerMapRef.current.get(zone.id)
      if (!tracker) {
        continue
      }

      const flush = tracker.flush()
      for (const vehicleClass of flush.newlyCountedClasses) {
        nextZoneCounts[zone.id][vehicleClass] += 1
      }
      overlayTracks.push(
        ...flush.activeTracks.map((track) => ({
          ...track,
          zoneId: zone.id,
          zoneLabel: zone.label,
        })),
      )
    }

    zoneCountsRef.current = nextZoneCounts
    applyZoneState(nextZoneCounts, overlayTracks, currentConfig.detectionZones)
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

    const currentConfig = configRef.current
    const analyzerKind = analyzerRef.current?.kind ?? 'mock'
    const overallCounts = buildOverallCounts(zoneCountsRef.current)
    const totalVehicles = Object.values(overallCounts).reduce((sum, count) => sum + count, 0)
    setSummary({
      startedAt: new Date(startedAt).toISOString(),
      endedAt: getIsoNow(),
      analyzerKind,
      totalVehicles,
      counts: overallCounts,
      fileName: selectedFileName,
      zoneSummaries: buildZoneSummaries(currentConfig.detectionZones, zoneCountsRef.current),
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
    resetSessionState(config.detectionZones)
  }

  function resetSessionState(zones: DetectionZone[]) {
    trackerMapRef.current = new Map()
    sessionStartRef.current = null
    lastAnalyzedAtRef.current = 0
    lastAnalyzedVideoTimeRef.current = -1
    countsRef.current = createEmptyCounts()
    zoneCountsRef.current = createZoneCountMap(zones)
    setCounts(createEmptyCounts())
    setTracks([])
    setZoneSummaries(createEmptyZoneSummaries(zones))
    setElapsedSeconds(0)
    setCurrentTime(0)
  }

  function applyZoneState(
    nextZoneCounts: Record<string, Record<VehicleClass, number>>,
    nextTracks: TrackedVehicle[],
    zones: DetectionZone[],
  ) {
    countsRef.current = buildOverallCounts(nextZoneCounts)
    zoneCountsRef.current = nextZoneCounts

    startTransition(() => {
      setTracks(nextTracks)
      setCounts(countsRef.current)
      setZoneSummaries(buildZoneSummaries(zones, nextZoneCounts))
    })
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

      const currentConfig = configRef.current
      const currentNow = getNowMs()
      const videoTimeDelta = Math.abs(video.currentTime - lastAnalyzedVideoTimeRef.current)
      const shouldAnalyze =
        currentNow - lastAnalyzedAtRef.current >= currentConfig.analysisIntervalMs &&
        videoTimeDelta >= 1 / 120

      if (shouldAnalyze && !analysisInFlightRef.current) {
        analysisInFlightRef.current = true
        lastAnalyzedAtRef.current = currentNow
        lastAnalyzedVideoTimeRef.current = video.currentTime
        try {
          analyzer.updateConfig(currentConfig)
          const nextZoneCounts = cloneZoneCountMap(zoneCountsRef.current)
          const nextTracks: TrackedVehicle[] = []

          const analyzedVideoTime = video.currentTime
          const analysisFrame = captureVideoFrame(video, analysisFrameRef.current)
          analysisFrameRef.current = analysisFrame

          for (const zone of currentConfig.detectionZones) {
            const detections = await analyzer.analyze(analysisFrame, zone.region)
            const tracker = getZoneTracker(zone.id)
            const update = tracker.update(detections, getAbsoluteCountingLine(zone))

            for (const vehicleClass of update.newlyCountedClasses) {
              nextZoneCounts[zone.id][vehicleClass] += 1
            }

            nextTracks.push(
              ...update.activeTracks.map((track) => ({
                ...track,
                zoneId: zone.id,
                zoneLabel: zone.label,
              })),
            )
          }

          applyZoneState(nextZoneCounts, nextTracks, currentConfig.detectionZones)
          startTransition(() => {
            setCurrentTime(analyzedVideoTime)
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

  function getZoneTracker(zoneId: string) {
    const existing = trackerMapRef.current.get(zoneId)
    if (existing) {
      existing.updateOptions(resolveTrackerOptions(configRef.current.trackingBias))
      return existing
    }

    const tracker = new VehicleTracker(resolveTrackerOptions(configRef.current.trackingBias))
    trackerMapRef.current.set(zoneId, tracker)
    return tracker
  }

  function addZone() {
    const zone = createDefaultZone(configRef.current.detectionZones.length + 1)
    const nextZones = [...configRef.current.detectionZones, zone]
    commitZoneLayout(nextZones, zone.id)
  }

  function removeActiveZone() {
    const currentConfig = configRef.current
    if (!currentConfig.activeZoneId || currentConfig.detectionZones.length <= 1) {
      return
    }

    const nextZones = currentConfig.detectionZones.filter((zone) => zone.id !== currentConfig.activeZoneId)
    commitZoneLayout(nextZones, nextZones[0]?.id ?? null)
  }

  function updateZoneRegion(zoneId: string, region: DetectionRegion) {
    setConfig((current) => ({
      ...current,
      detectionZones: current.detectionZones.map((zone) =>
        zone.id === zoneId
          ? {
              ...zone,
              region,
            }
          : zone,
      ),
    }))
  }

  function updateZoneLine(zoneId: string, countingLineOffset: number) {
    setConfig((current) => ({
      ...current,
      detectionZones: current.detectionZones.map((zone) =>
        zone.id === zoneId
          ? {
              ...zone,
              countingLineOffset,
            }
          : zone,
      ),
    }))
  }

  function commitZoneLayout(nextZones: DetectionZone[], activeZoneId: string | null) {
    const currentConfig = configRef.current
    const nextConfig = {
      ...currentConfig,
      activeZoneId,
      detectionZones: nextZones,
    }
    const nextZoneCounts = syncZoneCountMap(zoneCountsRef.current, nextZones)
    const nextZoneIds = new Set(nextZones.map((zone) => zone.id))

    configRef.current = nextConfig
    zoneCountsRef.current = nextZoneCounts
    countsRef.current = buildOverallCounts(nextZoneCounts)
    trackerMapRef.current = new Map(
      [...trackerMapRef.current.entries()].filter(([zoneId]) => nextZoneIds.has(zoneId)),
    )

    setConfig(nextConfig)
    startTransition(() => {
      setCounts(countsRef.current)
      setZoneSummaries(buildZoneSummaries(nextZones, nextZoneCounts))
      setTracks((currentTracks) => currentTracks.filter((track) => !track.zoneId || nextZoneIds.has(track.zoneId)))
    })
  }

  const activeZone = config.detectionZones.find((zone) => zone.id === config.activeZoneId) ?? config.detectionZones[0] ?? null

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">RoadScope Web</p>
          <h1>Drop in a traffic video and scan passing vehicles in the browser.</h1>
          <p className="hero-description">
            This React app now supports multiple independent detection zones, which is ideal for opposite traffic
            directions or separate carriageways in the same shot.
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
                <span>Model</span>
                <select
                  value={config.modelProfileId}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      modelProfileId: event.target.value as AnalysisConfig['modelProfileId'],
                    }))
                  }
                >
                  {modelProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Confidence {config.confidenceThreshold.toFixed(2)}</span>
                <input
                  type="range"
                  min="0.12"
                  max="0.75"
                  step="0.02"
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
                <span>Scan Interval {config.analysisIntervalMs} ms</span>
                <input
                  type="range"
                  min="30"
                  max="220"
                  step="10"
                  value={config.analysisIntervalMs}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      analysisIntervalMs: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>Zone Detail {config.detailLevel}</span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={config.detailLevel}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      detailLevel: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>Tracking Bias {config.trackingBias}</span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={config.trackingBias}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      trackingBias: Number(event.target.value),
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
                      analysisIntervalMs:
                        event.target.value === 'fast' ? 25 : event.target.value === 'balanced' ? 50 : 80,
                      detailLevel:
                        event.target.value === 'fast' ? 1 : event.target.value === 'balanced' ? 2 : 3,
                      trackingBias:
                        event.target.value === 'fast' ? 3 : event.target.value === 'balanced' ? 2 : 2,
                    }))
                  }
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="dense">Dense Traffic</option>
                </select>
              </label>
              <label>
                <span>
                  Zone Line {activeZone ? Math.round(activeZone.countingLineOffset * 100) : 0}%
                </span>
                <input
                  type="range"
                  min="0.2"
                  max="0.95"
                  step="0.01"
                  value={activeZone?.countingLineOffset ?? 0.5}
                  onChange={(event) => {
                    if (!activeZone) {
                      return
                    }
                    updateZoneLine(activeZone.id, Number(event.target.value))
                  }}
                />
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
              <button className="ghost-button" type="button" onClick={() => setShowRegionEditor((current) => !current)} disabled={!videoUrl}>
                {showRegionEditor ? 'Lock Zones' : 'Edit Zones'}
              </button>
              <button className="ghost-button" type="button" onClick={addZone}>
                Add Zone
              </button>
              <button className="ghost-button" type="button" onClick={removeActiveZone} disabled={config.detectionZones.length <= 1}>
                Remove Zone
              </button>
            </div>

            <div className="class-strip">
              {config.detectionZones.map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  className={`zone-chip${zone.id === config.activeZoneId ? ' zone-chip-active' : ''}`}
                  onClick={() =>
                    setConfig((current) => ({
                      ...current,
                      activeZoneId: zone.id,
                    }))
                  }
                >
                  {zone.label}
                </button>
              ))}
            </div>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
            <p className="helper-copy">
              Each zone is detected, tracked, and counted separately. The scanner briefly holds each analyzed frame so
              boxes and counts stay synced with the video. Higher zone detail helps smaller vehicles in dense highway
              traffic. Lower tracking bias is looser for crowded crossings, while higher bias is stricter. If the dense
              model cannot be parsed by the browser, scanning falls back to the stable fast model.
            </p>
          </div>

          <VideoStage
            videoRef={videoRef}
            overlayRef={overlayRef}
            videoUrl={videoUrl}
            statusLabel={`${status} • ${formatDuration(currentTime)} video time`}
            zones={config.detectionZones}
            activeZoneId={config.activeZoneId}
            showRegionEditor={showRegionEditor}
            onSelectZone={(zoneId) =>
              setConfig((current) => ({
                ...current,
                activeZoneId: zoneId,
              }))
            }
            onZoneRegionChange={updateZoneRegion}
          />
        </div>

        <ResultsPanel
          summary={summary}
          counts={deferredCounts}
          analyzerLabel={analyzerLabel}
          elapsedSeconds={elapsedSeconds}
          currentTime={currentTime}
          zoneSummaries={deferredZoneSummaries}
        />
      </section>
    </main>
  )
}

export default App

async function initializeAnalyzer(config: AnalysisConfig) {
  const { OnnxVehicleAnalyzer } = await import('./services/onnxVehicleAnalyzer')
  try {
    const analyzer = new OnnxVehicleAnalyzer(config)
    await analyzer.initialize(config)
    return { analyzer, config }
  } catch (error) {
    const fallbackConfig = createFallbackModelConfig(config)
    if (fallbackConfig.modelProfileId === config.modelProfileId) {
      throw error
    }

    const analyzer = new OnnxVehicleAnalyzer(fallbackConfig)
    await analyzer.initialize(fallbackConfig)
    return { analyzer, config: fallbackConfig }
  }
}

function createFallbackModelConfig(config: AnalysisConfig) {
  const fallbackModelProfileId: ModelProfileId = 'onnx-community/yolov10n'
  return {
    ...config,
    modelProfileId: fallbackModelProfileId,
  }
}

function createInitialZones() {
  return [createDefaultZone(1)]
}

function createDefaultZone(index: number): DetectionZone {
  const safeIndex = Math.max(1, index)
  const left = 0.03
  const top = 0.05
  const height = safeIndex % 2 === 0 ? 0.42 : 0.9

  return {
    id: `zone-${safeIndex}-${Math.random().toString(36).slice(2, 7)}`,
    label: `Zone ${safeIndex}`,
    region: {
      left,
      top,
      width: 0.94,
      height,
    },
    countingLineOffset: safeIndex % 2 === 0 ? 0.52 : 0.62,
  }
}

function createEmptyCounts() {
  return {
    car: 0,
    truck: 0,
    bus: 0,
    motorcycle: 0,
  } satisfies Record<VehicleClass, number>
}

function createZoneCountMap(zones: DetectionZone[]) {
  return Object.fromEntries(zones.map((zone) => [zone.id, createEmptyCounts()]))
}

function syncZoneCountMap(
  zoneCounts: Record<string, Record<VehicleClass, number>>,
  zones: DetectionZone[],
) {
  return Object.fromEntries(
    zones.map((zone) => [zone.id, { ...(zoneCounts[zone.id] ?? createEmptyCounts()) }]),
  ) as Record<string, Record<VehicleClass, number>>
}

function cloneZoneCountMap(zoneCounts: Record<string, Record<VehicleClass, number>>) {
  return Object.fromEntries(
    Object.entries(zoneCounts).map(([zoneId, counts]) => [zoneId, { ...counts }]),
  ) as Record<string, Record<VehicleClass, number>>
}

function buildOverallCounts(zoneCounts: Record<string, Record<VehicleClass, number>>) {
  const counts = createEmptyCounts()
  for (const zoneCount of Object.values(zoneCounts)) {
    for (const vehicleClass of vehicleClasses) {
      counts[vehicleClass] += zoneCount[vehicleClass] ?? 0
    }
  }
  return counts
}

function createEmptyZoneSummaries(zones: DetectionZone[]) {
  return zones.map(createZoneSummary)
}

function createZoneSummary(zone: DetectionZone): ZoneSummary {
  return {
    zoneId: zone.id,
    label: zone.label,
    totalVehicles: 0,
    counts: createEmptyCounts(),
  }
}

function buildZoneSummaries(zones: DetectionZone[], zoneCounts: Record<string, Record<VehicleClass, number>>) {
  return zones.map((zone) => {
    const counts = zoneCounts[zone.id] ?? createEmptyCounts()
    return {
      zoneId: zone.id,
      label: zone.label,
      totalVehicles: Object.values(counts).reduce((sum, count) => sum + count, 0),
      counts,
    }
  })
}

function getAbsoluteCountingLine(zone: DetectionZone) {
  return zone.region.top + zone.region.height * zone.countingLineOffset
}

function getNowMs() {
  return Date.now()
}

function getIsoNow() {
  return new Date().toISOString()
}

function captureVideoFrame(video: HTMLVideoElement, reusableCanvas: HTMLCanvasElement | null) {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) {
    throw new Error('Video frame is not ready yet.')
  }

  const canvas = reusableCanvas ?? document.createElement('canvas')
  if (canvas.width !== width) {
    canvas.width = width
  }
  if (canvas.height !== height) {
    canvas.height = height
  }

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to capture the current video frame.')
  }

  context.drawImage(video, 0, 0, width, height)
  return canvas
}

function resolveTrackerOptions(trackingBias: number) {
  const clampedBias = Math.min(5, Math.max(1, Math.round(trackingBias)))
  const looseness = (5 - clampedBias) / 4

  return {
    maxCenterDistance: 0.22 + looseness * 0.14,
    maxMissedFrames: Math.round(14 + looseness * 12),
    minVisibleFramesBeforeCounting: 3,
    exitCountSlack: 0.16 + looseness * 0.16,
    minIoUForDirectMatch: 0.08 - looseness * 0.05,
    countedTrackReleaseDistance: 0.14 - looseness * 0.06,
  }
}
