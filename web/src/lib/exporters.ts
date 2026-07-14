import type { AnalysisConfig, CountEvent, CountingZone, EngineInfo, SessionCounts } from '../types'
import { vehicleClasses } from '../types'
import { summarizeEvents } from './stats'

export interface SessionExport {
  fileName: string
  durationSeconds: number
  processedAt: string
  engine: EngineInfo | null
  config: Pick<AnalysisConfig, 'enginePreference' | 'confidence' | 'samplingFps'>
  zones: CountingZone[]
  counts: SessionCounts
  events: CountEvent[]
}

/** One row per counted vehicle: video time, zone, class, direction, track. */
export function eventsToCsv(events: readonly CountEvent[], zones: readonly CountingZone[]): string {
  const labelByZone = new Map(zones.map((zone) => [zone.id, zone.label]))
  const rows = [['video_time_s', 'zone', 'class', 'direction', 'track_id']]

  for (const event of events) {
    rows.push([
      event.videoTime.toFixed(2),
      labelByZone.get(event.zoneId) ?? event.zoneId,
      event.vehicleClass,
      event.direction,
      String(event.trackId),
    ])
  }

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

/** One row per zone with direction and class breakdowns, plus a totals row. */
export function summaryToCsv(events: readonly CountEvent[], zones: readonly CountingZone[]): string {
  const counts = summarizeEvents(events, zones)
  const rows = [['zone', 'line_orientation', 'total', 'down', 'up', 'left', 'right', ...vehicleClasses]]

  for (const zone of counts.zones) {
    rows.push([
      zone.label,
      zone.lineOrientation,
      String(zone.total),
      String(zone.byDirection.down),
      String(zone.byDirection.up),
      String(zone.byDirection.left),
      String(zone.byDirection.right),
      ...vehicleClasses.map((vehicleClass) => String(zone.byClass[vehicleClass])),
    ])
  }

  rows.push([
    'TOTAL',
    '',
    String(counts.total),
    String(counts.byDirection.down),
    String(counts.byDirection.up),
    String(counts.byDirection.left),
    String(counts.byDirection.right),
    ...vehicleClasses.map((vehicleClass) => String(counts.byClass[vehicleClass])),
  ])

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

export function buildSessionExport(input: {
  fileName: string
  durationSeconds: number
  engine: EngineInfo | null
  config: AnalysisConfig
  events: CountEvent[]
}): SessionExport {
  return {
    fileName: input.fileName,
    durationSeconds: input.durationSeconds,
    processedAt: new Date().toISOString(),
    engine: input.engine,
    config: {
      enginePreference: input.config.enginePreference,
      confidence: input.config.confidence,
      samplingFps: input.config.samplingFps,
    },
    zones: input.config.zones,
    counts: summarizeEvents(input.events, input.config.zones),
    events: input.events,
  }
}

export function downloadTextFile(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}
