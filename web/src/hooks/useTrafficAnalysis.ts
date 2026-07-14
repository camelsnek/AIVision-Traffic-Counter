import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { drawOverlay } from '../lib/drawOverlay'
import { buildSessionExport, downloadTextFile, eventsToCsv, summaryToCsv } from '../lib/exporters'
import { clampRect } from '../lib/geometry'
import { summarizeEvents } from '../lib/stats'
import { VehicleDetector } from '../services/vehicleDetector'
import { VideoProcessor } from '../services/videoProcessor'
import type {
  AnalysisConfig,
  CountEvent,
  CountingZone,
  EngineInfo,
  EnginePreference,
  LineOrientation,
  ModelProfileId,
  PreprocessingProfileId,
  RectNorm,
  SessionCounts,
  TrackSnapshot,
} from '../types'

export type AnalysisStatus = 'idle' | 'ready' | 'loading' | 'running' | 'stopped' | 'complete' | 'error'

export interface AnalysisProgress {
  /** 0..1 share of the video processed. */
  progress: number
  videoTime: number
  durationSeconds: number
  inferenceMs: number
  throughputFps: number
}

export interface VideoSize {
  width: number
  height: number
}

export interface TrafficAnalysis {
  videoRef: React.RefObject<HTMLVideoElement | null>
  overlayRef: React.RefObject<HTMLCanvasElement | null>

  videoUrl: string | null
  fileName: string | null
  videoSize: VideoSize | null
  loadFile(file: File): void

  status: AnalysisStatus
  error: string | null
  engine: EngineInfo | null
  gpuAvailable: boolean | null

  config: AnalysisConfig
  setModelProfile(modelProfileId: ModelProfileId): void
  setEnginePreference(preference: EnginePreference): void
  setPreprocessingProfile(preprocessingProfileId: PreprocessingProfileId): void
  setConfidence(confidence: number): void
  setSamplingFps(samplingFps: number): void

  zoneEditing: boolean
  setZoneEditing(editing: boolean): void
  activeZoneId: string | null
  setActiveZone(zoneId: string): void
  addZone(): void
  removeZone(zoneId: string): void
  updateZoneRegion(zoneId: string, region: RectNorm): void
  updateZoneLine(zoneId: string, lineOffset: number): void
  updateZoneOrientation(zoneId: string, lineOrientation: LineOrientation): void

  start(): Promise<void>
  stop(): void
  reset(): void
  canStart: boolean

  progress: AnalysisProgress
  counts: SessionCounts
  events: CountEvent[]

  exportEventsCsv(): void
  exportSummaryCsv(): void
  exportJson(): void
}

const INITIAL_PROGRESS: AnalysisProgress = {
  progress: 0,
  videoTime: 0,
  durationSeconds: 0,
  inferenceMs: 0,
  throughputFps: 0,
}

const MAX_OVERLAY_EDGE = 1600

const DEFAULT_CONFIG: AnalysisConfig = {
  modelProfileId: 'onnx-community/yolov10n',
  enginePreference: 'auto',
  preprocessingProfileId: 'standard-v1',
  confidence: 0.35,
  samplingFps: 10,
  zones: [],
}

export function useTrafficAnalysis(): TrafficAnalysis {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const processorRef = useRef<VideoProcessor | null>(null)
  const detectorRef = useRef<{ key: string; detector: VehicleDetector } | null>(null)
  const tracksRef = useRef<TrackSnapshot[]>([])
  const eventsRef = useRef<CountEvent[]>([])
  const nextZoneNumberRef = useRef(2)

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [videoSize, setVideoSize] = useState<VideoSize | null>(null)
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null)
  const [config, setConfig] = useState<AnalysisConfig>(() => ({
    ...DEFAULT_CONFIG,
    zones: [createZone(1)],
  }))
  const [zoneEditing, setZoneEditing] = useState(false)
  const [activeZoneId, setActiveZoneId] = useState<string | null>(config.zones[0]?.id ?? null)
  const [progress, setProgress] = useState<AnalysisProgress>(INITIAL_PROGRESS)
  const [events, setEvents] = useState<CountEvent[]>([])

  const counts = useMemo(() => summarizeEvents(events, config.zones), [events, config.zones])
  const isBusy = status === 'running' || status === 'loading'

  const redrawOverlay = useCallback(
    (tracks: readonly TrackSnapshot[], liveCounts: SessionCounts | null, editing: boolean) => {
      const overlay = overlayRef.current
      if (!overlay) {
        return
      }
      drawOverlay(overlay, {
        tracks,
        zones: config.zones,
        counts: liveCounts,
        activeZoneId,
        editing,
      })
    },
    [config.zones, activeZoneId],
  )

  // Keep the overlay in sync while idle (zone editing, config tweaks, resize).
  useEffect(() => {
    if (status !== 'running') {
      redrawOverlay(tracksRef.current, counts, zoneEditing)
    }
  }, [redrawOverlay, counts, zoneEditing, status, videoSize])

  useEffect(() => {
    let active = true
    void VehicleDetector.supportsWebGpu().then((available) => {
      if (active) {
        setGpuAvailable(available)
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    return () => {
      processorRef.current?.stop()
      void detectorRef.current?.detector.dispose()
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  // Wire up video metadata: canvas sizing and the Infinity-duration fix
  // (MediaRecorder webm files report Infinity until forced to buffer).
  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) {
      return
    }

    const handleMetadata = () => {
      if (!Number.isFinite(video.duration)) {
        const restore = () => {
          video.currentTime = 0
          video.removeEventListener('durationchange', restore)
          applySize()
        }
        video.addEventListener('durationchange', restore)
        video.currentTime = Number.MAX_SAFE_INTEGER
        return
      }
      applySize()
    }

    const applySize = () => {
      const overlay = overlayRef.current
      if (overlay && video.videoWidth && video.videoHeight) {
        const scale = Math.min(1, MAX_OVERLAY_EDGE / Math.max(video.videoWidth, video.videoHeight))
        overlay.width = Math.max(1, Math.round(video.videoWidth * scale))
        overlay.height = Math.max(1, Math.round(video.videoHeight * scale))
      }
      setVideoSize(video.videoWidth ? { width: video.videoWidth, height: video.videoHeight } : null)
    }

    video.addEventListener('loadedmetadata', handleMetadata)
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      handleMetadata()
    }
    return () => video.removeEventListener('loadedmetadata', handleMetadata)
  }, [videoUrl])

  const clearSession = useCallback(() => {
    tracksRef.current = []
    eventsRef.current = []
    setEvents([])
    setProgress(INITIAL_PROGRESS)
    setError(null)
  }, [])

  const loadFile = useCallback(
    (file: File) => {
      processorRef.current?.stop()
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
      const url = URL.createObjectURL(file)
      objectUrlRef.current = url
      setVideoUrl(url)
      setFileName(file.name)
      setVideoSize(null)
      setStatus('ready')
      clearSession()
    },
    [clearSession],
  )

  const start = useCallback(async () => {
    const video = videoRef.current
    if (!video || !videoUrl || config.zones.length === 0 || isBusy) {
      return
    }

    clearSession()
    setZoneEditing(false)
    setStatus('loading')

    const detectorKey = `${config.modelProfileId}:${config.enginePreference}`
    const currentDetector = detectorRef.current
    let detector = currentDetector?.key === detectorKey ? currentDetector.detector : null
    if (!detector) {
      try {
        if (currentDetector) {
          await currentDetector.detector.dispose()
          detectorRef.current = null
        }
        detector = await VehicleDetector.create(config.modelProfileId, config.enginePreference)
        detectorRef.current = { key: detectorKey, detector }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'The detection model could not be loaded.')
        setStatus('error')
        return
      }
    }
    setEngine(detector.info)

    const processor = new VideoProcessor(video, detector, config, {
      onFrame: (update) => {
        tracksRef.current = update.tracks
        if (update.newEvents.length > 0) {
          eventsRef.current = [...eventsRef.current, ...update.newEvents]
          setEvents(eventsRef.current)
        }
        setProgress({
          progress: update.progress,
          videoTime: update.videoTime,
          durationSeconds: update.durationSeconds,
          inferenceMs: update.inferenceMs,
          throughputFps: update.throughputFps,
        })
        const overlay = overlayRef.current
        if (overlay) {
          drawOverlay(overlay, {
            tracks: update.tracks,
            zones: config.zones,
            counts: summarizeEvents(eventsRef.current, config.zones),
            activeZoneId: null,
            editing: false,
          })
        }
      },
      onDone: (reason) => {
        processorRef.current = null
        setStatus(reason === 'complete' ? 'complete' : 'stopped')
        if (reason === 'complete') {
          setProgress((current) => ({ ...current, progress: 1 }))
        }
      },
      onError: (processError) => {
        processorRef.current = null
        setError(processError.message)
        setStatus('error')
      },
    })

    processorRef.current = processor
    setStatus('running')
    await processor.run()
  }, [videoUrl, config, isBusy, clearSession])

  const stop = useCallback(() => {
    processorRef.current?.stop()
  }, [])

  const reset = useCallback(() => {
    processorRef.current?.stop()
    clearSession()
    const video = videoRef.current
    if (video) {
      video.currentTime = 0
    }
    setStatus(videoUrl ? 'ready' : 'idle')
  }, [clearSession, videoUrl])

  const setModelProfile = useCallback((modelProfileId: ModelProfileId) => {
    setEngine(null)
    setConfig((current) => ({ ...current, modelProfileId }))
  }, [])

  const setEnginePreference = useCallback((enginePreference: EnginePreference) => {
    setEngine(null)
    setConfig((current) => ({ ...current, enginePreference }))
  }, [])

  const setPreprocessingProfile = useCallback((preprocessingProfileId: PreprocessingProfileId) => {
    setConfig((current) => ({ ...current, preprocessingProfileId }))
  }, [])

  const setConfidence = useCallback((confidence: number) => {
    setConfig((current) => ({ ...current, confidence }))
  }, [])

  const setSamplingFps = useCallback((samplingFps: number) => {
    setConfig((current) => ({ ...current, samplingFps }))
  }, [])

  const setActiveZone = useCallback((zoneId: string) => {
    setActiveZoneId(zoneId)
  }, [])

  const addZone = useCallback(() => {
    const zone = createZone(nextZoneNumberRef.current++)
    setConfig((current) => ({ ...current, zones: [...current.zones, zone] }))
    setActiveZoneId(zone.id)
  }, [])

  const removeZone = useCallback((zoneId: string) => {
    setConfig((current) => {
      if (current.zones.length <= 1) {
        return current
      }
      return { ...current, zones: current.zones.filter((zone) => zone.id !== zoneId) }
    })
    setActiveZoneId((activeId) => (activeId === zoneId ? null : activeId))
  }, [])

  const updateZoneRegion = useCallback((zoneId: string, region: RectNorm) => {
    setConfig((current) => ({
      ...current,
      zones: current.zones.map((zone) => (zone.id === zoneId ? { ...zone, region: clampRect(region) } : zone)),
    }))
  }, [])

  const updateZoneLine = useCallback((zoneId: string, lineOffset: number) => {
    const clamped = Math.min(0.98, Math.max(0.02, lineOffset))
    setConfig((current) => ({
      ...current,
      zones: current.zones.map((zone) => (zone.id === zoneId ? { ...zone, lineOffset: clamped } : zone)),
    }))
  }, [])

  const updateZoneOrientation = useCallback((zoneId: string, lineOrientation: LineOrientation) => {
    setConfig((current) => ({
      ...current,
      zones: current.zones.map((zone) => (zone.id === zoneId ? { ...zone, lineOrientation } : zone)),
    }))
  }, [])

  const exportBaseName = (fileName ?? 'traffic-session').replace(/\.[^.]+$/, '')

  return {
    videoRef,
    overlayRef,
    videoUrl,
    fileName,
    videoSize,
    loadFile,
    status,
    error,
    engine,
    gpuAvailable,
    config,
    setModelProfile,
    setEnginePreference,
    setPreprocessingProfile,
    setConfidence,
    setSamplingFps,
    zoneEditing,
    setZoneEditing,
    activeZoneId,
    setActiveZone,
    addZone,
    removeZone,
    updateZoneRegion,
    updateZoneLine,
    updateZoneOrientation,
    start,
    stop,
    reset,
    canStart: Boolean(videoUrl) && !isBusy && config.zones.length > 0,
    progress,
    counts,
    events,
    exportEventsCsv: () => downloadTextFile(`${exportBaseName}-events.csv`, 'text/csv', eventsToCsv(events, config.zones)),
    exportSummaryCsv: () =>
      downloadTextFile(
        `${exportBaseName}-summary.csv`,
        'text/csv',
        summaryToCsv(events, config.zones, config.preprocessingProfileId),
      ),
    exportJson: () =>
      downloadTextFile(
        `${exportBaseName}-session.json`,
        'application/json',
        JSON.stringify(
          buildSessionExport({
            fileName: fileName ?? 'unknown',
            durationSeconds: progress.durationSeconds,
            engine,
            config,
            events,
          }),
          null,
          2,
        ),
      ),
  }
}


function createZone(zoneNumber: number): CountingZone {
  return {
    id: `zone-${zoneNumber}`,
    label: `Zone ${zoneNumber}`,
    region:
      zoneNumber % 2 === 0
        ? { left: 0.06, top: 0.12, width: 0.88, height: 0.34 }
        : { left: 0.06, top: 0.3, width: 0.88, height: 0.55 },
    lineOrientation: 'horizontal',
    lineOffset: 0.55,
  }
}
