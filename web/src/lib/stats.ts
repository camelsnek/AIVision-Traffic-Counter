import type {
  CountEvent,
  CountingZone,
  DirectionCounts,
  FlowBucket,
  SessionCounts,
  VehicleClass,
  ZoneCounts,
} from '../types'

export function emptyClassCounts(): Record<VehicleClass, number> {
  return { car: 0, truck: 0, bus: 0, motorcycle: 0 }
}

export function emptyDirectionCounts(): DirectionCounts {
  return { down: 0, up: 0, right: 0, left: 0 }
}

/** Aggregates count events into session, zone, class, and direction totals. */
export function summarizeEvents(events: readonly CountEvent[], zones: readonly CountingZone[]): SessionCounts {
  const zoneById = new Map<string, ZoneCounts>()
  for (const zone of zones) {
    zoneById.set(zone.id, {
      zoneId: zone.id,
      label: zone.label,
      lineOrientation: zone.lineOrientation,
      total: 0,
      byDirection: emptyDirectionCounts(),
      byClass: emptyClassCounts(),
    })
  }

  const byClass = emptyClassCounts()
  const byDirection = emptyDirectionCounts()

  for (const event of events) {
    byClass[event.vehicleClass] += 1
    byDirection[event.direction] += 1

    const zone = zoneById.get(event.zoneId)
    if (zone) {
      zone.total += 1
      zone.byDirection[event.direction] += 1
      zone.byClass[event.vehicleClass] += 1
    }
  }

  return {
    total: events.length,
    byClass,
    byDirection,
    zones: zones.map((zone) => zoneById.get(zone.id)!),
  }
}

const BUCKET_STEPS_SECONDS = [5, 10, 15, 30, 60, 120, 300, 600]

/**
 * Buckets count events over video time for the flow-rate chart.
 * Picks a human bucket length (5s..10min) so the chart stays readable.
 */
export function flowBuckets(
  events: readonly CountEvent[],
  durationSeconds: number,
  maxBuckets = 36,
): FlowBucket[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return []
  }

  const length =
    BUCKET_STEPS_SECONDS.find((step) => durationSeconds / step <= maxBuckets) ??
    BUCKET_STEPS_SECONDS[BUCKET_STEPS_SECONDS.length - 1]
  const bucketCount = Math.max(1, Math.ceil(durationSeconds / length))
  const buckets: FlowBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    start: index * length,
    length,
    count: 0,
    byDirection: emptyDirectionCounts(),
  }))

  for (const event of events) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(event.videoTime / length)))
    buckets[index].count += 1
    buckets[index].byDirection[event.direction] += 1
  }

  return buckets
}
