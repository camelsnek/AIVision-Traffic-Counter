import type {
  CountEvent,
  CountingZone,
  Detection,
  Direction,
  PointNorm,
  RectNorm,
  TrackSnapshot,
  VehicleClass,
} from '../types'
import { centerDistance, clamp, clamp01, intersectionOverUnion, rectCenter } from './geometry'

export interface TrafficCounterOptions {
  /** Matched detections required before a track may produce counts. */
  minHits?: number
  /** Consecutive missed samples before a track is dropped. */
  maxMisses?: number
}

export interface CounterUpdate {
  tracks: TrackSnapshot[]
  events: CountEvent[]
}

interface PendingCrossing {
  zoneId: string
  direction: Direction
  videoTime: number
}

interface Track {
  id: number
  box: RectNorm
  velX: number
  velY: number
  hits: number
  misses: number
  confirmed: boolean
  classScores: Record<VehicleClass, number>
  lastConfidence: number
  /** Center of the most recent real observation. */
  lastCenter: PointNorm
  /** Center of the real observation before `lastCenter`, if any. */
  prevCenter: PointNorm | null
  trail: PointNorm[]
  countedZones: Set<string>
  /** Crossings that happened while the track was still tentative. */
  pending: PendingCrossing[]
}

interface MatchCandidate {
  track: Track
  detectionIndex: number
  score: number
}

const MAX_TRAIL_POINTS = 24
const MAX_PREDICTION_STEPS = 4
/** Candidate gate bounds, in normalized frame units. */
const MIN_GATE = 0.05
const MAX_GATE = 0.28

/**
 * Tracks vehicles across sampled frames and counts each confirmed track
 * exactly once per zone when its center crosses the zone's counting line.
 *
 * Counting happens ONLY on line crossings. Tracks that never cross a line
 * are never counted, no matter how long they live; flickering detections
 * die as tentative tracks and are never counted either.
 */
export class TrafficCounter {
  private readonly zones: CountingZone[]
  private readonly minHits: number
  private readonly maxMisses: number
  private tracks: Track[] = []
  private nextTrackId = 1
  private nextEventSeq = 1

  constructor(zones: readonly CountingZone[], options: TrafficCounterOptions = {}) {
    this.zones = zones.map((zone) => ({ ...zone, region: { ...zone.region } }))
    this.minHits = options.minHits ?? 3
    this.maxMisses = options.maxMisses ?? 5
  }

  update(detections: readonly Detection[], videoTime: number): CounterUpdate {
    const events: CountEvent[] = []
    const matchedTracks = new Set<Track>()
    const matchedDetections = new Set<number>()

    for (const candidate of this.buildCandidates(detections)) {
      if (matchedTracks.has(candidate.track) || matchedDetections.has(candidate.detectionIndex)) {
        continue
      }

      matchedTracks.add(candidate.track)
      matchedDetections.add(candidate.detectionIndex)
      this.applyMatch(candidate.track, detections[candidate.detectionIndex], videoTime, events)
    }

    const survivors: Track[] = []
    for (const track of this.tracks) {
      if (matchedTracks.has(track)) {
        survivors.push(track)
        continue
      }

      track.misses += 1
      if (track.misses > this.maxMisses) {
        continue
      }

      // Coast along the last known velocity so re-association stays plausible.
      track.box = {
        left: clamp01(track.box.left + track.velX),
        top: clamp01(track.box.top + track.velY),
        width: track.box.width,
        height: track.box.height,
      }
      survivors.push(track)
    }

    detections.forEach((detection, index) => {
      if (!matchedDetections.has(index)) {
        survivors.push(this.createTrack(detection))
      }
    })

    this.tracks = survivors

    return { tracks: this.tracks.map(snapshotTrack), events }
  }

  private buildCandidates(detections: readonly Detection[]): MatchCandidate[] {
    const candidates: MatchCandidate[] = []

    for (const track of this.tracks) {
      const steps = Math.min(track.misses + 1, MAX_PREDICTION_STEPS)
      const predicted: RectNorm = {
        left: track.box.left + track.velX * steps,
        top: track.box.top + track.velY * steps,
        width: track.box.width,
        height: track.box.height,
      }

      for (const [detectionIndex, detection] of detections.entries()) {
        const iou = intersectionOverUnion(predicted, detection.box)
        const distance = centerDistance(predicted, detection.box)
        const sizeGate = 0.9 * Math.hypot(detection.box.width, detection.box.height)
        // A track without an established velocity gets a wider search radius.
        const gate = clamp(sizeGate, MIN_GATE, MAX_GATE) * (track.hits < 2 ? 1.6 : 1)

        if (iou <= 0.02 && distance >= gate) {
          continue
        }

        const sameClassBonus = track.classScores[detection.vehicleClass] > 0 ? 0.08 : 0
        candidates.push({
          track,
          detectionIndex,
          score: iou * 0.65 + Math.max(0, 1 - distance / gate) * 0.35 + sameClassBonus,
        })
      }
    }

    return candidates.sort((a, b) => b.score - a.score)
  }

  private applyMatch(track: Track, detection: Detection, videoTime: number, events: CountEvent[]) {
    const center = rectCenter(detection.box)
    const missedSpan = track.misses + 1
    const stepX = (center.x - track.lastCenter.x) / missedSpan
    const stepY = (center.y - track.lastCenter.y) / missedSpan

    if (track.hits === 1) {
      track.velX = stepX
      track.velY = stepY
    } else {
      track.velX = track.velX * 0.5 + stepX * 0.5
      track.velY = track.velY * 0.5 + stepY * 0.5
    }

    track.prevCenter = track.lastCenter
    track.lastCenter = center
    track.box = { ...detection.box }
    track.hits += 1
    track.misses = 0
    track.lastConfidence = detection.confidence
    track.classScores[detection.vehicleClass] += detection.confidence
    track.trail.push(center)
    if (track.trail.length > MAX_TRAIL_POINTS) {
      track.trail.shift()
    }

    const justConfirmed = !track.confirmed && track.hits >= this.minHits
    if (justConfirmed) {
      track.confirmed = true
      for (const pending of track.pending) {
        events.push(this.emitCount(track, pending.zoneId, pending.direction, pending.videoTime))
      }
      track.pending = []
    }

    this.detectCrossings(track, videoTime, events)
  }

  private detectCrossings(track: Track, videoTime: number, events: CountEvent[]) {
    const previous = track.prevCenter
    if (!previous) {
      return
    }

    const current = track.lastCenter
    const midX = (previous.x + current.x) / 2

    for (const zone of this.zones) {
      if (track.countedZones.has(zone.id)) {
        continue
      }
      if (midX < zone.region.left || midX > zone.region.left + zone.region.width) {
        continue
      }

      const lineY = zone.region.top + zone.region.height * zone.lineOffset
      let direction: Direction | null = null
      if (previous.y < lineY && current.y >= lineY) {
        direction = 'down'
      } else if (previous.y > lineY && current.y <= lineY) {
        direction = 'up'
      }

      if (!direction) {
        continue
      }

      if (track.confirmed) {
        events.push(this.emitCount(track, zone.id, direction, videoTime))
      } else {
        // Remember the crossing; it becomes a count only if the track survives
        // long enough to be confirmed. Noise never confirms, so noise never counts.
        track.countedZones.add(zone.id)
        track.pending.push({ zoneId: zone.id, direction, videoTime })
      }
    }
  }

  private emitCount(track: Track, zoneId: string, direction: Direction, videoTime: number): CountEvent {
    track.countedZones.add(zoneId)
    return {
      seq: this.nextEventSeq++,
      trackId: track.id,
      zoneId,
      vehicleClass: votedClass(track),
      direction,
      videoTime,
    }
  }

  private createTrack(detection: Detection): Track {
    const center = rectCenter(detection.box)
    const classScores = { car: 0, truck: 0, bus: 0, motorcycle: 0 }
    classScores[detection.vehicleClass] = detection.confidence

    return {
      id: this.nextTrackId++,
      box: { ...detection.box },
      velX: 0,
      velY: 0,
      hits: 1,
      misses: 0,
      confirmed: false,
      classScores,
      lastConfidence: detection.confidence,
      lastCenter: center,
      prevCenter: null,
      trail: [center],
      countedZones: new Set(),
      pending: [],
    }
  }
}

/** The class with the highest cumulative confidence over the track lifetime. */
function votedClass(track: Track): VehicleClass {
  let best: VehicleClass = 'car'
  let bestScore = -1
  for (const [vehicleClass, score] of Object.entries(track.classScores) as [VehicleClass, number][]) {
    if (score > bestScore) {
      best = vehicleClass
      bestScore = score
    }
  }
  return best
}

function snapshotTrack(track: Track): TrackSnapshot {
  return {
    id: track.id,
    vehicleClass: votedClass(track),
    confidence: track.lastConfidence,
    box: track.box,
    hits: track.hits,
    confirmed: track.confirmed,
    coasting: track.misses > 0,
    trail: [...track.trail],
    countedZones: [...track.countedZones],
  }
}
