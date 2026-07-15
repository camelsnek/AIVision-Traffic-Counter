import { describe, expect, it } from 'vitest'
import { buildSessionExport, summaryToCsv } from '../src/lib/exporters'
import { flowBuckets, summarizeEvents } from '../src/lib/stats'
import type { AnalysisConfig, CountEvent, CountingZone } from '../src/types'

const zoneA: CountingZone = {
  id: 'z1',
  label: 'Zone 1',
  region: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
  lineOrientation: 'horizontal',
  lineOffset: 0.5,
}
const zoneB: CountingZone = {
  id: 'z2',
  label: 'Zone 2',
  region: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
  lineOrientation: 'vertical',
  lineOffset: 0.75,
}

function event(seq: number, partial: Omit<CountEvent, 'seq'>): CountEvent {
  return { seq, ...partial }
}

describe('summarizeEvents', () => {
  it('aggregates totals per class, direction, and zone', () => {
    const events: CountEvent[] = [
      event(1, { trackId: 1, zoneId: 'z1', vehicleClass: 'car', direction: 'down', videoTime: 1 }),
      event(2, { trackId: 2, zoneId: 'z1', vehicleClass: 'truck', direction: 'up', videoTime: 2 }),
      event(3, { trackId: 3, zoneId: 'z2', vehicleClass: 'car', direction: 'right', videoTime: 3 }),
      event(4, { trackId: 4, zoneId: 'z2', vehicleClass: 'bus', direction: 'left', videoTime: 4 }),
      // Unknown zone: contributes to global totals but to no zone.
      event(5, { trackId: 5, zoneId: 'ghost', vehicleClass: 'motorcycle', direction: 'right', videoTime: 5 }),
    ]

    const summary = summarizeEvents(events, [zoneA, zoneB])

    expect(summary.total).toBe(5)
    expect(summary.byClass).toEqual({ car: 2, truck: 1, bus: 1, motorcycle: 1 })
    expect(summary.byDirection).toEqual({ down: 1, up: 1, right: 2, left: 1 })

    expect(summary.zones).toHaveLength(2)
    const [z1, z2] = summary.zones
    expect(z1).toEqual({
      zoneId: 'z1',
      label: 'Zone 1',
      lineOrientation: 'horizontal',
      total: 2,
      byDirection: { down: 1, up: 1, right: 0, left: 0 },
      byClass: { car: 1, truck: 1, bus: 0, motorcycle: 0 },
    })
    expect(z2).toEqual({
      zoneId: 'z2',
      label: 'Zone 2',
      lineOrientation: 'vertical',
      total: 2,
      byDirection: { down: 0, up: 0, right: 1, left: 1 },
      byClass: { car: 1, truck: 0, bus: 1, motorcycle: 0 },
    })
    // The ghost-zone event is in the global totals but nowhere per-zone.
    const zoneTotal = summary.zones.reduce((sum, zone) => sum + zone.total, 0)
    expect(zoneTotal).toBe(4)
  })
})

describe('summaryToCsv', () => {
  it('exports each zone orientation and all four direction totals', () => {
    const events: CountEvent[] = [
      event(1, { trackId: 1, zoneId: 'z1', vehicleClass: 'car', direction: 'down', videoTime: 1 }),
      event(2, { trackId: 2, zoneId: 'z2', vehicleClass: 'bus', direction: 'left', videoTime: 2 }),
    ]

    expect(summaryToCsv(events, [zoneA, zoneB], 'night-clahe-v1').split('\r\n')).toEqual([
      'zone,line_orientation,preprocessing_profile,total,down,up,left,right,car,truck,bus,motorcycle',
      'Zone 1,horizontal,night-clahe-v1,1,1,0,0,0,1,0,0,0',
      'Zone 2,vertical,night-clahe-v1,1,0,0,1,0,0,0,1,0',
      'TOTAL,,night-clahe-v1,2,1,0,1,0,1,0,1,0',
    ])
  })
})

describe('buildSessionExport', () => {
  it('persists the versioned preprocessing profile and exact parameters', () => {
    const config: AnalysisConfig = {
      modelProfileId: 'onnx-community/yolov10n',
      enginePreference: 'cpu',
      preprocessingProfileId: 'night-clahe-v1',
      confidence: 0.35,
      samplingFps: 5,
      zones: [zoneA],
    }

    const result = buildSessionExport({
      fileName: 'night-highway.mp4',
      durationSeconds: 120,
      engine: { modelProfileId: config.modelProfileId, device: 'wasm', dtype: 'q8' },
      config,
      events: [],
    })

    expect(result.config).toEqual({
      modelProfileId: 'onnx-community/yolov10n',
      enginePreference: 'cpu',
      preprocessingProfileId: 'night-clahe-v1',
      confidence: 0.35,
      samplingFps: 5,
      preprocessingParameters: {
        transform: 'luminance-clahe',
        tileColumns: 8,
        tileRows: 8,
        clipLimit: 2,
      },
    })
  })
})

describe('flowBuckets', () => {
  it('chooses a 5s bucket length and places events in the right bucket', () => {
    const events: CountEvent[] = [
      event(1, { trackId: 1, zoneId: 'z1', vehicleClass: 'car', direction: 'down', videoTime: 0 }),
      event(2, { trackId: 2, zoneId: 'z1', vehicleClass: 'car', direction: 'up', videoTime: 4.9 }),
      event(3, { trackId: 3, zoneId: 'z1', vehicleClass: 'car', direction: 'down', videoTime: 5.0 }),
      event(4, { trackId: 4, zoneId: 'z1', vehicleClass: 'car', direction: 'down', videoTime: 119.9 }),
    ]

    const buckets = flowBuckets(events, 120, 30)

    expect(buckets).toHaveLength(24)
    expect(buckets.every((bucket) => bucket.length === 5)).toBe(true)
    expect(buckets[0].count).toBe(2) // t=0 and t=4.9
    expect(buckets[1].count).toBe(1) // t=5.0
    expect(buckets[23].count).toBe(1) // t=119.9
    expect(buckets[0].byDirection).toEqual({ down: 1, up: 1, right: 0, left: 0 })
    expect(buckets[1].byDirection).toEqual({ down: 1, up: 0, right: 0, left: 0 })
    const counted = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
    expect(counted).toBe(4)
  })

  it('returns an empty array for a zero or non-finite duration', () => {
    const events: CountEvent[] = [
      event(1, { trackId: 1, zoneId: 'z1', vehicleClass: 'car', direction: 'down', videoTime: 0 }),
    ]
    expect(flowBuckets(events, 0, 30)).toEqual([])
    expect(flowBuckets(events, Infinity, 30)).toEqual([])
  })
})
