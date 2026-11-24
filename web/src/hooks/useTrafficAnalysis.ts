import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, connectLive, type ModelInfo, type RunPerformance, type ServerMessage, type StageTimings, type VideoMeta } from '../lib/api'
import { drawOverlay } from '../lib/drawOverlay'
import { clampRect } from '../lib/geometry'
import { summarizeEvents } from '../lib/stats'
import type {
  AnalysisConfig,
  CountEvent,
  CountingZone,
  DevicePreference,
  EngineInfo,
  LineOrientation,
  RectNorm,
  SessionCounts,
  TrackSnapshot,
} from '../types'

export type AnalysisStatus =
  | 'idle'
  | 'uploading'
  | 'ready'
  | 'loading'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'complete'
  | 'error'

export interface AnalysisProgress {
  /** 0..1 share of the video processed. */
  progress: number
  videoTime: number
  durationSeconds: number
  timings: Partial<StageTimings>
  throughputFps: number
  frames: number
  performance: RunPerformance | null
}

export interface VideoSize {
  width: number
  height: number
}

const INITIAL_PROGRESS: AnalysisProgress = {
  progress: 0,
  videoTime: 0,
  durationSeconds: 0,
  timings: {},
  throughputFps: 0,
  frames: 0,
  performance: null,
}

const DEFAULT_CONFIG: Omit<AnalysisConfig, 'zones'> = {
  modelId: 'rfdetr-small',
  device: 'auto',
  preprocessingProfileId: 'standard-v1',
  confidence: 0.4,
  samplingFps: 0,
}

const CONFIG_STORAGE_KEY = 'aivision.config.v2'

function loadStoredConfig(): AnalysisConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<AnalysisConfig>
      if (Array.isArray(stored.zones) && stored.zones.length > 0) {
        return { ...DEFAULT_CONFIG, ...stored, zones: stored.zones }
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return { ...DEFAULT_CONFIG, zones: [createZone(1)] }
}

export function useTrafficAnalysis() {
  const frameRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const tracksRef = useRef<TrackSnapshot[]>([])
  const frameUrlRef = useRef<string | null>(null)
  const pendingFrameRef = useRef<{ runId: string; tracks: TrackSnapshot[] } | null>(null)
  const runIdRef = useRef<string | null>(null)
  const nextZoneNumberRef = useRef(2)

  const [connected, setConnected] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null)
  const [providers, setProviders] = useState<string[]>([])
  const [videos, setVideos] = useState<VideoMeta[]>([])
  const [video, setVideo] = useState<VideoMeta | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [liveFrame, setLiveFrame] = useState(false)
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [config, setConfig] = useState<AnalysisConfig>(loadStoredConfig)
  const [zoneEditing, setZoneEditing] = useState(false)
  const [activeZoneId, setActiveZoneId] = useState<string | null>(config.zones[0]?.id ?? null)
  const [progress, setProgress] = useState<AnalysisProgress>(INITIAL_PROGRESS)
  const [events, setEvents] = useState<CountEvent[]>([])
  /** Zones of the run being displayed (frozen at start), for live counts/overlay. */
  const [runZones, setRunZones] = useState<CountingZone[] | null>(null)

  const busy = status === 'running' || status === 'paused' || status === 'loading'
  const displayZones = busy && runZones ? runZones : config.zones
  const counts = useMemo<SessionCounts>(() => summarizeEvents(events, displayZones), [events, displayZones])

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
    } catch {
      // storage full or disabled
    }
  }, [config])

  // Static info + video library.
  useEffect(() => {
    void api
      .info()
      .then((info) => {
        setModels(info.models)
        setGpuAvailable(info.gpu)
        setProviders(info.providers)
      })
      .catch((infoError: unknown) => setError(errorMessage(infoError)))
    void api.videos().then(setVideos).catch(() => undefined)
  }, [])

  const redraw = useCallback(
    (tracks: readonly TrackSnapshot[]) => {
      const overlay = overlayRef.current
      if (!overlay) {
        return
      }
      drawOverlay(overlay, {
        tracks,
        zones: displayZones,
        counts,
        activeZoneId,
        editing: zoneEditing,
      })
    },
    [displayZones, counts, activeZoneId, zoneEditing],
  )
  const redrawRef = useRef(redraw)
  useEffect(() => {
    redrawRef.current = redraw
    redraw(tracksRef.current)
  }, [redraw])

  // Size the overlay canvas to the video's aspect ratio.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay || !video) {
      return
    }
    const scale = Math.min(1, 1600 / Math.max(video.width, video.height))
    overlay.width = Math.max(1, Math.round(video.width * scale))
    overlay.height = Math.max(1, Math.round(video.height * scale))
    redrawRef.current(tracksRef.current)
  }, [video])

  // Live channel.
  useEffect(() => {
    const handleMessage = (message: ServerMessage) => {
      switch (message.type) {
        case 'hello':
          break
        case 'run': {
          const isNew = runIdRef.current !== message.runId
          runIdRef.current = message.runId
          setVideo(message.video)
          setRunZones(message.config.zones)
          if (isNew) {
            setEvents([])
            tracksRef.current = []
          }
          break
        }
        case 'status': {
          if (message.runId !== runIdRef.current) {
            break
          }
          setStatus(message.status)
          setError(message.error)
          setEngine(message.engine)
          setProgress({
            progress: message.progress,
            videoTime: message.videoTime,
            durationSeconds: message.durationSeconds,
            timings: message.timings,
            throughputFps: message.throughputFps,
            frames: message.frames,
            performance: message.performance,
          })
          if (message.events.length > 0) {
            setEvents((current) => [...current.slice(0, message.eventsFrom), ...message.events])
          }
          break
        }
        case 'frame':
          pendingFrameRef.current = { runId: message.runId, tracks: message.tracks }
          break
      }
    }

    const handleImage = (jpeg: Blob) => {
      const pending = pendingFrameRef.current
      pendingFrameRef.current = null
      if (!pending || pending.runId !== runIdRef.current) {
        return
      }
      const url = URL.createObjectURL(jpeg)
      const image = frameRef.current
      const previous = frameUrlRef.current
      frameUrlRef.current = url
      if (image) {
        // Paint overlay only when the matching frame is decoded, so boxes and pixels stay in sync.
        image.onload = () => {
          tracksRef.current = pending.tracks
          redrawRef.current(pending.tracks)
          if (previous) {
            URL.revokeObjectURL(previous)
          }
        }
        image.src = url
      }
      setLiveFrame(true)
    }

    return connectLive(handleMessage, handleImage, setConnected)
  }, [])

  const selectVideo = useCallback((meta: VideoMeta) => {
    if (busy) {
      return
    }
    runIdRef.current = null
    tracksRef.current = []
    setVideo(meta)
    setLiveFrame(false)
    setEvents([])
    setRunZones(null)
    setProgress({ ...INITIAL_PROGRESS, durationSeconds: meta.durationSeconds })
    setStatus('ready')
    setError(null)
    const image = frameRef.current
    if (image) {
      image.onload = null
      image.src = api.posterUrl(meta.id)
    }
  }, [busy])

  const loadFile = useCallback(
    async (file: File) => {
      if (busy) {
        return
      }
      setStatus('uploading')
      setError(null)
      setUploadProgress(0)
      try {
        const meta = await api.uploadVideo(file, setUploadProgress)
        setVideos((current) => [meta, ...current.filter((item) => item.id !== meta.id)])
        selectVideo(meta)
      } catch (uploadError) {
        setError(errorMessage(uploadError))
        setStatus(video ? 'ready' : 'idle')
      } finally {
        setUploadProgress(null)
      }
    },
    [busy, selectVideo, video],
  )

  const deleteVideo = useCallback(
    async (id: string) => {
      try {
        await api.deleteVideo(id)
        setVideos((current) => current.filter((item) => item.id !== id))
        if (video?.id === id) {
          setVideo(null)
          setStatus('idle')
          setLiveFrame(false)
        }
      } catch (deleteError) {
        setError(errorMessage(deleteError))
      }
    },
    [video],
  )

  const start = useCallback(async () => {
    if (!video || busy || config.zones.length === 0) {
      return
    }
    setZoneEditing(false)
    setError(null)
    setEvents([])
    tracksRef.current = []
    setProgress({ ...INITIAL_PROGRESS, durationSeconds: video.durationSeconds })
    setStatus('loading')
    try {
      const { runId } = await api.startRun(video.id, config)
      runIdRef.current = runId
      setRunZones(config.zones)
    } catch (startError) {
      setError(errorMessage(startError))
      setStatus('error')
    }
  }, [video, busy, config])

  const control = useCallback(async (action: 'pause' | 'resume' | 'stop') => {
    try {
      const result = await api.control(action)
      setStatus(result.status)
    } catch (controlError) {
      setError(errorMessage(controlError))
    }
  }, [])

  const reset = useCallback(() => {
    if (busy) {
      return
    }
    if (video) {
      selectVideo(video)
    }
  }, [busy, video, selectVideo])

  const updateZones = useCallback((update: (zones: CountingZone[]) => CountingZone[]) => {
    setConfig((current) => ({ ...current, zones: update(current.zones) }))
  }, [])

  return {
    frameRef,
    overlayRef,
    connected,
    providers,
    models,
    gpuAvailable,
    videos,
    video,
    videoSize: video ? ({ width: video.width, height: video.height } satisfies VideoSize) : null,
    uploadProgress,
    liveFrame,
    loadFile,
    selectVideo,
    deleteVideo,
    status,
    error,
    engine,
    config,
    setModel: (modelId: string) => setConfig((current) => ({ ...current, modelId })),
    setDevice: (device: DevicePreference) => setConfig((current) => ({ ...current, device })),
    setConfidence: (confidence: number) => setConfig((current) => ({ ...current, confidence })),
    setSamplingFps: (samplingFps: number) => setConfig((current) => ({ ...current, samplingFps })),
    zoneEditing,
    setZoneEditing,
    activeZoneId,
    setActiveZone: setActiveZoneId,
    addZone: () => {
      const zone = createZone(nextZoneNumberRef.current++)
      updateZones((zones) => [...zones, zone])
      setActiveZoneId(zone.id)
    },
    removeZone: (zoneId: string) => {
      updateZones((zones) => (zones.length <= 1 ? zones : zones.filter((zone) => zone.id !== zoneId)))
      setActiveZoneId((activeId) => (activeId === zoneId ? null : activeId))
    },
    updateZoneRegion: (zoneId: string, region: RectNorm) =>
      updateZones((zones) => zones.map((zone) => (zone.id === zoneId ? { ...zone, region: clampRect(region) } : zone))),
    updateZoneLine: (zoneId: string, lineOffset: number) => {
      const clamped = Math.min(0.98, Math.max(0.02, lineOffset))
      updateZones((zones) => zones.map((zone) => (zone.id === zoneId ? { ...zone, lineOffset: clamped } : zone)))
    },
    updateZoneOrientation: (zoneId: string, lineOrientation: LineOrientation) =>
      updateZones((zones) => zones.map((zone) => (zone.id === zoneId ? { ...zone, lineOrientation } : zone))),
    start,
    pause: () => void control('pause'),
    resume: () => void control('resume'),
    stop: () => void control('stop'),
    reset,
    canStart: Boolean(video) && !busy && status !== 'uploading' && config.zones.length > 0 && connected,
    busy,
    progress,
    counts,
    events,
    exportUrl: api.exportUrl,
  }
}

export type TrafficAnalysis = ReturnType<typeof useTrafficAnalysis>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
