import { useRef } from 'react'
import type { PointerEvent, RefObject } from 'react'

import { clamp } from '../lib/format'
import type { DetectionRegion, DetectionZone } from '../types'

type RegionHandle = 'move' | 'resize'

interface VideoStageProps {
  videoRef: RefObject<HTMLVideoElement | null>
  overlayRef: RefObject<HTMLCanvasElement | null>
  videoUrl: string | null
  statusLabel: string
  zones: DetectionZone[]
  activeZoneId: string | null
  showRegionEditor: boolean
  onSelectZone: (zoneId: string) => void
  onZoneRegionChange: (zoneId: string, nextRegion: DetectionRegion) => void
}

interface DragState {
  zoneId: string
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
  zones,
  activeZoneId,
  showRegionEditor,
  onSelectZone,
  onZoneRegionChange,
}: VideoStageProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<DragState | null>(null)

  function startDrag(event: PointerEvent, zoneId: string, mode: RegionHandle) {
    if (!showRegionEditor) {
      return
    }

    const shell = shellRef.current
    const zone = zones.find((entry) => entry.id == zoneId)
    if (!shell || !zone) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    onSelectZone(zoneId)

    dragStateRef.current = {
      zoneId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initialRegion: zone.region,
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
      onZoneRegionChange(dragState.zoneId, {
        ...dragState.initialRegion,
        left: nextLeft,
        top: nextTop,
      })
      return
    }

    const nextWidth = clamp(dragState.initialRegion.width + deltaX, 0.12, 1 - dragState.initialRegion.left)
    const nextHeight = clamp(dragState.initialRegion.height + deltaY, 0.12, 1 - dragState.initialRegion.top)
    onZoneRegionChange(dragState.zoneId, {
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
            {zones.map((zone) => {
              const isActive = zone.id === activeZoneId
              return (
                <div
                  key={zone.id}
                  className={[
                    'detection-region',
                    isActive ? 'detection-region-active' : '',
                    showRegionEditor ? 'detection-region-editable' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    left: `${zone.region.left * 100}%`,
                    top: `${zone.region.top * 100}%`,
                    width: `${zone.region.width * 100}%`,
                    height: `${zone.region.height * 100}%`,
                  }}
                  onPointerDown={(event) => startDrag(event, zone.id, 'move')}
                  onClick={() => onSelectZone(zone.id)}
                >
                  <span className="detection-region-label">{zone.label}</span>
                  <div
                    className="detection-region-line"
                    style={{
                      top: `${zone.countingLineOffset * 100}%`,
                    }}
                  />
                  {showRegionEditor && isActive ? (
                    <button
                      type="button"
                      className="detection-region-handle"
                      onPointerDown={(event) => startDrag(event, zone.id, 'resize')}
                      aria-label={`Resize ${zone.label}`}
                    />
                  ) : null}
                </div>
              )
            })}
          </>
        ) : (
          <div className="empty-state">
            <p>Drop in a roadside video and the app will scan passing vehicles frame by frame.</p>
          </div>
        )}
      </div>
      <div className="stage-footer">
        <span className="status-pill">{statusLabel}</span>
        <p>Each detection zone now tracks and counts independently, which works well for opposite traffic directions.</p>
      </div>
    </section>
  )
}
