import { useRef } from 'react'
import type { PointerEvent, RefObject } from 'react'

import { clamp } from '../lib/format'
import type { DetectionRegion } from '../types'

type RegionHandle = 'move' | 'resize'

interface VideoStageProps {
  videoRef: RefObject<HTMLVideoElement | null>
  overlayRef: RefObject<HTMLCanvasElement | null>
  videoUrl: string | null
  statusLabel: string
  detectionRegion: DetectionRegion
  showRegionEditor: boolean
  onDetectionRegionChange: (nextRegion: DetectionRegion) => void
}

interface DragState {
  mode: RegionHandle
  startX: number
  startY: number
  initialRegion: DetectionRegion
}

export function VideoStage({
  videoRef,
  overlayRef,
  videoUrl,
  statusLabel,
  detectionRegion,
  showRegionEditor,
  onDetectionRegionChange,
}: VideoStageProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<DragState | null>(null)

  function startDrag(event: PointerEvent, mode: RegionHandle) {
    if (!showRegionEditor) {
      return
    }

    const shell = shellRef.current
    if (!shell) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    dragStateRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initialRegion: detectionRegion,
    }

    shell.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent) {
    const shell = shellRef.current
    const dragState = dragStateRef.current
    if (!shell || !dragState) {
      return
    }

    const rect = shell.getBoundingClientRect()
    const deltaX = (event.clientX - dragState.startX) / rect.width
    const deltaY = (event.clientY - dragState.startY) / rect.height

    if (dragState.mode === 'move') {
      const nextLeft = clamp(dragState.initialRegion.left + deltaX, 0, 1 - dragState.initialRegion.width)
      const nextTop = clamp(dragState.initialRegion.top + deltaY, 0, 1 - dragState.initialRegion.height)
      onDetectionRegionChange({
        ...dragState.initialRegion,
        left: nextLeft,
        top: nextTop,
      })
      return
    }

    const nextWidth = clamp(dragState.initialRegion.width + deltaX, 0.18, 1 - dragState.initialRegion.left)
    const nextHeight = clamp(dragState.initialRegion.height + deltaY, 0.18, 1 - dragState.initialRegion.top)
    onDetectionRegionChange({
      ...dragState.initialRegion,
      width: nextWidth,
      height: nextHeight,
    })
  }

  function endDrag(event: PointerEvent) {
    const shell = shellRef.current
    dragStateRef.current = null
    if (shell?.hasPointerCapture(event.pointerId)) {
      shell.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section className="video-stage">
      <div
        ref={shellRef}
        className={`video-shell${showRegionEditor ? ' video-shell-editing' : ''}`}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {videoUrl ? (
          <>
            <video ref={videoRef} className="video-element" controls playsInline preload="metadata" src={videoUrl} />
            <canvas ref={overlayRef} className="video-overlay" />
            <div
              className={`detection-region${showRegionEditor ? ' detection-region-editable' : ''}`}
              style={{
                left: `${detectionRegion.left * 100}%`,
                top: `${detectionRegion.top * 100}%`,
                width: `${detectionRegion.width * 100}%`,
                height: `${detectionRegion.height * 100}%`,
              }}
              onPointerDown={(event) => startDrag(event, 'move')}
            >
              <span className="detection-region-label">Detection zone</span>
              {showRegionEditor ? (
                <button
                  type="button"
                  className="detection-region-handle"
                  onPointerDown={(event) => startDrag(event, 'resize')}
                  aria-label="Resize detection region"
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>Drop in a roadside video and the app will scan passing vehicles frame by frame.</p>
          </div>
        )}
      </div>
      <div className="stage-footer">
        <span className="status-pill">{statusLabel}</span>
        <p>Browser analysis uses the local file only. No upload is required for the web workflow.</p>
      </div>
    </section>
  )
}
