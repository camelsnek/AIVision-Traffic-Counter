import { useRef } from 'react'
import type { ChangeEvent } from 'react'

import { api, type VideoMeta } from '../lib/api'
import { formatDuration } from '../lib/format'

interface VideoLibraryProps {
  videos: VideoMeta[]
  selectedId: string | null
  disabled: boolean
  selectVideo(video: VideoMeta): void
  deleteVideo(id: string): Promise<void>
  loadFile(file: File): Promise<void>
}

export function VideoLibrary({ videos, selectedId, disabled, selectVideo, deleteVideo, loadFile }: VideoLibraryProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (file) {
      void loadFile(file)
    }
    event.currentTarget.value = ''
  }

  return (
    <section className="library" aria-label="Video library">
      <header className="library-head">
        <h2>Videos</h2>
        <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => inputRef.current?.click()}>
          Add video
        </button>
      </header>
      {videos.length === 0 ? (
        <p className="library-empty">Uploaded videos appear here so you can re-run them with different zones or models.</p>
      ) : (
        <ul className="library-grid">
          {videos.map((video) => (
            <li key={video.id} className={video.id === selectedId ? 'library-item is-selected' : 'library-item'}>
              <button
                type="button"
                className="library-open"
                disabled={disabled}
                aria-pressed={video.id === selectedId}
                onClick={() => selectVideo(video)}
              >
                <img src={api.posterUrl(video.id)} alt="" loading="lazy" />
                <span className="library-name">{video.name}</span>
                <span className="library-meta">
                  {formatDuration(video.durationSeconds)}, {video.height}p
                </span>
              </button>
              <button
                type="button"
                className="library-delete"
                aria-label={`Delete ${video.name}`}
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(`Delete ${video.name} from the library?`)) {
                    void deleteVideo(video.id)
                  }
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={inputRef} type="file" accept="video/*,.mkv,.ts,.mts" hidden onChange={handleFileInput} />
    </section>
  )
}
