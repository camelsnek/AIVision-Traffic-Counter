import type { CountingZone, SessionCounts, TrackSnapshot } from '../types'
import { classColors, countingLineColor, zoneActiveColor, zoneColor } from './palette'

const classInitials = { car: 'C', truck: 'T', bus: 'B', motorcycle: 'M' } as const

export interface OverlayState {
  tracks: readonly TrackSnapshot[]
  zones: readonly CountingZone[]
  counts: SessionCounts | null
  activeZoneId: string | null
  /** True while the zone editor is open (zones highlighted, tracks hidden). */
  editing: boolean
}

/**
 * Paints tracks, zones, and counting lines onto the overlay canvas.
 * The canvas must have the video's intrinsic pixel size; callers position it
 * over the video element with CSS.
 */
export function drawOverlay(canvas: HTMLCanvasElement, state: OverlayState) {
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  const { width, height } = canvas
  if (!width || !height) {
    return
  }

  // Stroke and font sizes scale with frame resolution so 4K footage
  // doesn't render hairline boxes.
  const unit = Math.max(width, height) / 1000
  context.clearRect(0, 0, width, height)

  for (const zone of state.zones) {
    drawZone(context, zone, state, width, height, unit)
  }

  if (!state.editing) {
    for (const track of state.tracks) {
      drawTrack(context, track, width, height, unit)
    }
  }
}

function drawZone(
  context: CanvasRenderingContext2D,
  zone: CountingZone,
  state: OverlayState,
  width: number,
  height: number,
  unit: number,
) {
  const left = zone.region.left * width
  const top = zone.region.top * height
  const zoneWidth = zone.region.width * width
  const zoneHeight = zone.region.height * height
  const isActive = state.editing && zone.id === state.activeZoneId
  const stroke = isActive ? zoneActiveColor : zoneColor

  context.save()
  context.strokeStyle = stroke
  context.globalAlpha = state.editing ? 0.95 : 0.4
  context.lineWidth = 1.6 * unit
  context.setLineDash([10 * unit, 7 * unit])
  context.strokeRect(left, top, zoneWidth, zoneHeight)
  context.setLineDash([])

  // Counting line with direction totals for its configured axis.
  context.globalAlpha = 1
  context.strokeStyle = countingLineColor
  context.lineWidth = 2.4 * unit
  context.beginPath()
  if (zone.lineOrientation === 'vertical') {
    const lineX = left + zoneWidth * zone.lineOffset
    context.moveTo(lineX, top)
    context.lineTo(lineX, top + zoneHeight)
  } else {
    const lineY = top + zoneHeight * zone.lineOffset
    context.moveTo(left, lineY)
    context.lineTo(left + zoneWidth, lineY)
  }
  context.stroke()

  const zoneCounts = state.counts?.zones.find((entry) => entry.zoneId === zone.id)
  const fontSize = 15 * unit
  context.font = `600 ${fontSize}px Barlow, ui-sans-serif, system-ui, sans-serif`

  const label = zoneCounts
    ? zone.lineOrientation === 'vertical'
      ? `${zone.label}  ·  ${zoneCounts.byDirection.left} \u2190  ${zoneCounts.byDirection.right} \u2192`
      : `${zone.label}  ·  ${zoneCounts.byDirection.down} \u2193  ${zoneCounts.byDirection.up} \u2191`
    : zone.label
  const paddingX = 8 * unit
  const chipHeight = 24 * unit
  const chipWidth = context.measureText(label).width + paddingX * 2
  const chipTop = Math.max(0, top - chipHeight - 4 * unit)

  context.fillStyle = 'rgba(17, 19, 22, 0.82)'
  fillRoundedRect(context, left, chipTop, chipWidth, chipHeight, 6 * unit)
  context.fillStyle = isActive ? zoneActiveColor : '#eef0ea'
  context.textBaseline = 'middle'
  context.fillText(label, left + paddingX, chipTop + chipHeight / 2)
  context.restore()
}

function drawTrack(
  context: CanvasRenderingContext2D,
  track: TrackSnapshot,
  width: number,
  height: number,
  unit: number,
) {
  if (!track.confirmed) {
    return
  }

  const color = classColors[track.vehicleClass]
  const left = track.box.left * width
  const top = track.box.top * height
  const boxWidth = track.box.width * width
  const boxHeight = track.box.height * height
  const counted = track.countedZones.length > 0

  context.save()

  if (track.trail.length > 1) {
    context.strokeStyle = color
    context.globalAlpha = 0.5
    context.lineWidth = 1.6 * unit
    context.beginPath()
    context.moveTo(track.trail[0].x * width, track.trail[0].y * height)
    for (let index = 1; index < track.trail.length; index += 1) {
      const point = track.trail[index]
      context.lineTo(point.x * width, point.y * height)
    }
    context.stroke()
  }

  // Coasting = predicted position while the detector briefly lost the vehicle:
  // a faint dashed box only, no label, so it never reads as a confident detection.
  if (track.coasting) {
    context.globalAlpha = 0.4
    context.strokeStyle = color
    context.lineWidth = 1.6 * unit
    context.setLineDash([6 * unit, 5 * unit])
    context.strokeRect(left, top, boxWidth, boxHeight)
    context.restore()
    return
  }

  context.globalAlpha = 1
  context.strokeStyle = color
  context.lineWidth = (counted ? 2.6 : 2) * unit
  context.strokeRect(left, top, boxWidth, boxHeight)

  // Compact tag: class initial + track number, tick once counted.
  const label = `${classInitials[track.vehicleClass]}${track.id}${counted ? ' \u2713' : ''}`
  const fontSize = 12 * unit
  context.font = `600 ${fontSize}px Barlow, ui-sans-serif, system-ui, sans-serif`
  const paddingX = 4 * unit
  const chipHeight = 16 * unit
  const chipWidth = context.measureText(label).width + paddingX * 2
  const chipTop = Math.max(0, top - chipHeight)

  context.fillStyle = counted ? color : 'rgba(17, 19, 22, 0.82)'
  context.fillRect(left, chipTop, chipWidth, chipHeight)
  context.fillStyle = counted ? '#111316' : color
  context.textBaseline = 'middle'
  context.fillText(label, left + paddingX, chipTop + chipHeight / 2 + 0.5 * unit)

  context.restore()
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.roundRect(left, top, width, height, radius)
  context.fill()
}
