import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import { clamp } from '../lib/geometry'
import type { CountingZone, RectNorm } from '../types'

/** Smallest zone edge length, as a fraction of the frame. */
const MIN_ZONE_SIZE = 0.12

type DragKind = 'move' | 'resize' | 'line'

interface DragState {
  kind: DragKind
  zoneId: string
  pointerId: number
  originX: number
  originY: number
  /** Zone region at drag start; deltas are applied against this. */
  region: RectNorm
}

interface ZoneEditorProps {
  zones: CountingZone[]
  editing: boolean
  activeZoneId: string | null
  setActiveZone(zoneId: string): void
  updateZoneRegion(zoneId: string, region: RectNorm): void
  updateZoneLine(zoneId: string, lineOffset: number): void
}

/**
 * Transparent hit-testing layer over the video. The canvas overlay paints
 * zone outlines, counting lines, and labels; this layer only provides
 * pointer targets and drag handles while zone editing is on.
 */
export function ZoneEditor({
  zones,
  editing,
  activeZoneId,
  setActiveZone,
  updateZoneRegion,
  updateZoneLine,
}: ZoneEditorProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, zone: CountingZone, kind: DragKind) => {
    const layer = layerRef.current
    if (!editing || !layer || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setActiveZone(zone.id)
    dragRef.current = {
      kind,
      zoneId: zone.id,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      region: zone.region,
    }
    layer.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const layer = layerRef.current
    if (!drag || !layer || event.pointerId !== drag.pointerId) {
      return
    }
    const rect = layer.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }

    if (drag.kind === 'line') {
      const zoneTopPx = rect.top + drag.region.top * rect.height
      const zoneHeightPx = drag.region.height * rect.height
      if (zoneHeightPx > 0) {
        updateZoneLine(drag.zoneId, clamp((event.clientY - zoneTopPx) / zoneHeightPx, 0, 1))
      }
      return
    }

    const deltaX = (event.clientX - drag.originX) / rect.width
    const deltaY = (event.clientY - drag.originY) / rect.height

    if (drag.kind === 'move') {
      updateZoneRegion(drag.zoneId, {
        left: clamp(drag.region.left + deltaX, 0, 1 - drag.region.width),
        top: clamp(drag.region.top + deltaY, 0, 1 - drag.region.height),
        width: drag.region.width,
        height: drag.region.height,
      })
      return
    }

    updateZoneRegion(drag.zoneId, {
      left: drag.region.left,
      top: drag.region.top,
      width: clamp(drag.region.width + deltaX, MIN_ZONE_SIZE, 1 - drag.region.left),
      height: clamp(drag.region.height + deltaY, MIN_ZONE_SIZE, 1 - drag.region.top),
    })
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const layer = layerRef.current
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }
    dragRef.current = null
    if (layer?.hasPointerCapture(event.pointerId)) {
      layer.releasePointerCapture(event.pointerId)
    }
  }

  const selectOnKey = (event: ReactKeyboardEvent<HTMLDivElement>, zoneId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setActiveZone(zoneId)
    }
  }

  return (
    <div
      ref={layerRef}
      className={editing ? 'zone-layer is-editing' : 'zone-layer'}
      aria-hidden={!editing}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {zones.map((zone) => (
        <div
          key={zone.id}
          role="button"
          tabIndex={editing ? 0 : -1}
          aria-label={`${zone.label}: drag to move, corner to resize, line to set crossing`}
          className={zone.id === activeZoneId ? 'zone-box is-active' : 'zone-box'}
          style={{
            left: `${zone.region.left * 100}%`,
            top: `${zone.region.top * 100}%`,
            width: `${zone.region.width * 100}%`,
            height: `${zone.region.height * 100}%`,
          }}
          onPointerDown={(event) => beginDrag(event, zone, 'move')}
          onKeyDown={(event) => selectOnKey(event, zone.id)}
        >
          <div
            className="zone-line"
            style={{ top: `${zone.lineOffset * 100}%` }}
            onPointerDown={(event) => beginDrag(event, zone, 'line')}
          >
            <span className="zone-line-grip" />
          </div>
          <div className="zone-resize" onPointerDown={(event) => beginDrag(event, zone, 'resize')} />
        </div>
      ))}
    </div>
  )
}
