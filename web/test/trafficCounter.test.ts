import { describe, expect, it } from 'vitest'
import { TrafficCounter } from '../src/lib/trafficCounter'
import type { CountEvent, CountingZone, Detection, TrackSnapshot, VehicleClass } from '../src/types'

// --- stream synthesis helpers -------------------------------------------------

function carBox(cx: number, cy: number, w = 0.1, h = 0.08): Detection {
  return {
    vehicleClass: 'car',
    confidence: 0.8,
    box: { left: cx - w / 2, top: cy - h / 2, width: w, height: h },
  }
}

function classBox(
  vehicleClass: VehicleClass,
  confidence: number,
  cx: number,
  cy: number,
  w = 0.1,
  h = 0.08,
): Detection {
  return { vehicleClass, confidence, box: { left: cx - w / 2, top: cy - h / 2, width: w, height: h } }
}

const standardZone: CountingZone = {
  id: 'z1',
  label: 'Zone 1',
  // Counting line sits at y = 0.1 + 0.8 * 0.5 = 0.5, x-range [0.1, 0.9].
  region: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
  lineOffset: 0.5,
}

interface DriveResult {
  events: CountEvent[]
  updates: { tracks: TrackSnapshot[]; events: CountEvent[] }[]
}

/** Feeds one detection list per frame, stepping videoTime by `dt`, and
 *  accumulates every event emitted across the run. */
function drive(counter: TrafficCounter, frames: readonly Detection[][], dt = 0.1, t0 = 0): DriveResult {
  const events: CountEvent[] = []
  const updates: DriveResult['updates'] = []
  frames.forEach((detections, index) => {
    const update = counter.update(detections, t0 + index * dt)
    events.push(...update.events)
    updates.push(update)
  })
  return { events, updates }
}

// --- scenarios ----------------------------------------------------------------

describe('TrafficCounter counting contract', () => {
  it('counts a downward line crossing exactly once with the crossing time', () => {
    const counter = new TrafficCounter([standardZone])
    const ys = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]
    const { events } = drive(
      counter,
      ys.map((y) => [carBox(0.5, y)]),
    )

    expect(events).toHaveLength(1)
    const [event] = events
    expect(event.direction).toBe('down')
    expect(event.vehicleClass).toBe('car')
    expect(event.zoneId).toBe('z1')
    // First sample at/below the line is y=0.5 at index 4 -> videoTime 0.4.
    const crossIndex = ys.findIndex((y) => y >= 0.5)
    expect(event.videoTime).toBeCloseTo(crossIndex * 0.1, 10)
  })

  it('counts an upward line crossing exactly once', () => {
    const counter = new TrafficCounter([standardZone])
    const ys = [0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3]
    const { events } = drive(
      counter,
      ys.map((y) => [carBox(0.5, y)]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].direction).toBe('up')
  })

  it('never counts a track that does not cross the counting line', () => {
    const counter = new TrafficCounter([standardZone])
    // 20 samples drifting horizontally at constant y=0.3, never reaching 0.5.
    const frames = Array.from({ length: 20 }, (_, i) => [carBox(0.2 + i * 0.02, 0.3)])
    const { events, updates } = drive(counter, frames)

    expect(events).toHaveLength(0)
    // The track is nonetheless confirmed by hits alone.
    expect(updates.some((u) => u.tracks.some((t) => t.confirmed))).toBe(true)
  })

  it('never counts a stationary object', () => {
    const counter = new TrafficCounter([standardZone])
    const frames = Array.from({ length: 50 }, () => [carBox(0.5, 0.45)])
    const { events } = drive(counter, frames)

    expect(events).toHaveLength(0)
  })

  it('never counts flickering detections that die before confirmation', () => {
    const counter = new TrafficCounter([standardZone])
    const frames: Detection[][] = []
    // Three bursts at fresh x positions: 2 present frames (crossing 0.5),
    // then 6 empty frames so the tentative track dies at maxMisses=5.
    for (const x of [0.3, 0.5, 0.7]) {
      frames.push([carBox(x, 0.48)])
      frames.push([carBox(x, 0.52)])
      for (let i = 0; i < 6; i += 1) {
        frames.push([])
      }
    }
    const { events } = drive(counter, frames)

    expect(events).toHaveLength(0)
  })

  it('counts a crossing that happens during a detection gap', () => {
    const counter = new TrafficCounter([standardZone])
    // Descending car confirmed at y=0.4, missed for 2 frames, reappears past
    // the line at y=0.6. The crossing is detected on re-association.
    const frames: Detection[][] = [
      [carBox(0.5, 0.3)],
      [carBox(0.5, 0.35)],
      [carBox(0.5, 0.4)],
      [],
      [],
      [carBox(0.5, 0.6)],
    ]
    const { events } = drive(counter, frames)

    expect(events).toHaveLength(1)
    expect(events[0].direction).toBe('down')
  })

  it('counts two parallel vehicles as two distinct tracks', () => {
    const counter = new TrafficCounter([standardZone])
    const ys = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]
    const { events } = drive(
      counter,
      ys.map((y) => [carBox(0.3, y), carBox(0.7, y)]),
    )

    expect(events).toHaveLength(2)
    expect(events.every((e) => e.direction === 'down')).toBe(true)
    expect(new Set(events.map((e) => e.trackId)).size).toBe(2)
  })

  it('resolves the counted class by cumulative confidence voting', () => {
    const counter = new TrafficCounter([standardZone])
    const ys = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]
    const frames = ys.map((y, i) =>
      i % 2 === 0 ? [classBox('car', 0.3, 0.5, y)] : [classBox('truck', 0.9, 0.5, y)],
    )
    const { events } = drive(counter, frames)

    expect(events).toHaveLength(1)
    // truck accrues 0.9 per hit, car only 0.3 -> truck wins the vote.
    expect(events[0].vehicleClass).toBe('truck')
  })

  it('honors a tentative crossing only once the track is confirmed', () => {
    const counter = new TrafficCounter([standardZone])
    // Crosses between sample 1 (0.48) and sample 2 (0.55) while still tentative,
    // then keeps being detected until hits reach minHits=3.
    const ys = [0.48, 0.55, 0.6, 0.65, 0.7]
    const { events, updates } = drive(
      counter,
      ys.map((y) => [carBox(0.5, y)]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].direction).toBe('down')
    // The pending crossing is emitted exactly in the update where hits hit 3.
    const emittingUpdates = updates.filter((u) => u.events.length > 0)
    expect(emittingUpdates).toHaveLength(1)
    expect(emittingUpdates[0].tracks[0].hits).toBe(3)
    // videoTime is the tentative crossing time (sample index 1), not the confirm frame.
    expect(events[0].videoTime).toBeCloseTo(0.1, 10)
  })

  it('counts each zone at most once per track across stacked zones', () => {
    const zoneTop: CountingZone = {
      id: 'z1',
      label: 'Zone 1',
      region: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
      lineOffset: 0.375, // line at y = 0.4
    }
    const zoneBottom: CountingZone = {
      id: 'z2',
      label: 'Zone 2',
      region: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
      lineOffset: 0.75, // line at y = 0.7
    }
    const counter = new TrafficCounter([zoneTop, zoneBottom])
    const ys = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]
    const { events } = drive(
      counter,
      ys.map((y) => [carBox(0.5, y)]),
    )

    expect(events).toHaveLength(2)
    expect(new Set(events.map((e) => e.zoneId))).toEqual(new Set(['z1', 'z2']))
    expect(new Set(events.map((e) => e.trackId)).size).toBe(1)
  })

  it('does not count a crossing outside the zone horizontal extent', () => {
    const counter = new TrafficCounter([standardZone])
    // x=0.95 is right of the zone x-range [0.1, 0.9].
    const ys = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]
    const { events } = drive(
      counter,
      ys.map((y) => [carBox(0.95, y)]),
    )

    expect(events).toHaveLength(0)
  })
})
