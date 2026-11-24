import type { AnalysisConfig, CountEvent, EngineInfo, TrackSnapshot } from '../types'

export interface ModelInfo {
  id: string
  label: string
  description: string
  inputSize: number
  downloaded: boolean
}

export interface ServerInfo {
  version: string
  providers: string[]
  gpu: boolean
  models: ModelInfo[]
}

export interface VideoMeta {
  id: string
  name: string
  sizeBytes: number
  width: number
  height: number
  fps: number
  durationSeconds: number
  frameCount: number
  codec: string
}

export interface StageTimings {
  decodeMs: number
  preprocessMs: number
  inferenceMs: number
  postprocessMs: number
  trackingMs: number
}

export interface RunPerformance {
  frames: number
  wallSeconds: number
  fps: number
  medianInferenceMs: number
  realtimeFactor: number
  hwDecode: boolean
}

export type RunStatus = 'loading' | 'running' | 'paused' | 'complete' | 'stopped' | 'error'

export type ServerMessage =
  | { type: 'hello'; busy: boolean }
  | { type: 'run'; runId: string; video: VideoMeta; config: AnalysisConfig }
  | {
      type: 'status'
      runId: string
      status: RunStatus
      error: string | null
      engine: EngineInfo | null
      progress: number
      videoTime: number
      durationSeconds: number
      timings: Partial<StageTimings>
      throughputFps: number
      frames: number
      performance: RunPerformance | null
      eventsFrom: number
      events: CountEvent[]
    }
  | { type: 'frame'; runId: string; seq: number; videoTime: number; tracks: TrackSnapshot[] }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // keep the HTTP status text
    }
    throw new Error(detail)
  }
  return (await response.json()) as T
}

export const api = {
  info: () => request<ServerInfo>('/api/info'),
  videos: () => request<VideoMeta[]>('/api/videos'),
  deleteVideo: (id: string) => request<{ ok: boolean }>(`/api/videos/${id}`, { method: 'DELETE' }),
  posterUrl: (id: string) => `/api/videos/${id}/poster.jpg`,
  startRun: (videoId: string, config: AnalysisConfig) =>
    request<{ runId: string }>('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, config }),
    }),
  control: (action: 'pause' | 'resume' | 'stop') =>
    request<{ runId: string; status: RunStatus }>(`/api/runs/current/${action}`, { method: 'POST' }),
  exportUrl: (kind: 'events.csv' | 'summary.csv' | 'session.json') => `/api/runs/current/export/${kind}`,

  /** Upload with progress (fetch has no upload progress events). */
  uploadVideo(file: File, onProgress: (fraction: number) => void): Promise<VideoMeta> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/videos')
      xhr.responseType = 'json'
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded / event.total)
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as VideoMeta)
        } else {
          const detail = (xhr.response as { detail?: unknown } | null)?.detail
          reject(new Error(typeof detail === 'string' ? detail : `Upload failed (${xhr.status})`))
        }
      }
      xhr.onerror = () => reject(new Error('Upload failed: the server is unreachable.'))
      const form = new FormData()
      form.append('file', file)
      xhr.send(form)
    })
  },
}

/** Reconnecting WebSocket: JSON messages plus a binary JPEG after each `frame` message. */
export function connectLive(
  onMessage: (message: ServerMessage) => void,
  onFrameImage: (jpeg: Blob) => void,
  onConnection: (connected: boolean) => void,
): () => void {
  let socket: WebSocket | null = null
  let closed = false
  let retry: number | undefined

  const open = () => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${protocol}://${location.host}/api/ws`)
    socket.binaryType = 'blob'
    socket.onopen = () => onConnection(true)
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        onMessage(JSON.parse(event.data) as ServerMessage)
      } else {
        onFrameImage(event.data as Blob)
      }
    }
    socket.onclose = () => {
      onConnection(false)
      if (!closed) {
        retry = window.setTimeout(open, 1000)
      }
    }
  }
  open()

  return () => {
    closed = true
    window.clearTimeout(retry)
    socket?.close()
  }
}
