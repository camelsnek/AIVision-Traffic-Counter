import type { DetectionBox, TrackedVehicle } from '../types'

interface TrackingUpdate {
  activeTracks: TrackedVehicle[]
  newlyCountedClasses: TrackedVehicle['vehicleClass'][]
}

interface MatchCandidate {
  trackId: number
  detectionIndex: number
  score: number
}

interface CountedFootprint {
  trackId: number
  boundingBox: DetectionBox
  vehicleClass: TrackedVehicle['vehicleClass']
  ttl: number
}

interface VehicleTrackerOptions {
  maxCenterDistance?: number
  maxMissedFrames?: number
  minVisibleFramesBeforeCounting?: number
  exitCountSlack?: number
  minIoUForDirectMatch?: number
  countedTrackReleaseDistance?: number
}

interface ResolvedVehicleTrackerOptions {
  maxCenterDistance: number
  maxMissedFrames: number
  minVisibleFramesBeforeCounting: number
  exitCountSlack: number
  minIoUForDirectMatch: number
  countedTrackReleaseDistance: number
}

export class VehicleTracker {
  private options: ResolvedVehicleTrackerOptions
  private nextTrackId = 1
  private tracks = new Map<number, TrackedVehicle>()
  private countedFootprints: CountedFootprint[] = []

  constructor(options: VehicleTrackerOptions = {}) {
    this.options = resolveOptions(options)
  }

  reset() {
    this.nextTrackId = 1
    this.tracks.clear()
    this.countedFootprints = []
  }

  updateOptions(options: VehicleTrackerOptions) {
    this.options = resolveOptions(options)
  }

  update(detections: DetectionBox[], countingLinePosition: number): TrackingUpdate {
    this.decayCountedFootprints()
    const normalizedDetections = suppressDuplicateDetections(detections)
    const updatedTracks = new Map<number, TrackedVehicle>()
    const newlyCountedClasses: TrackedVehicle['vehicleClass'][] = []
    const matchedTrackIds = new Set<number>()
    const matchedDetectionIndexes = new Set<number>()
    const matchCandidates = buildMatchCandidates({
      tracks: [...this.tracks.values()],
      detections: normalizedDetections,
      maxCenterDistance: this.options.maxCenterDistance,
      minIoUForDirectMatch: this.options.minIoUForDirectMatch,
    })

    for (const candidate of matchCandidates) {
      if (matchedTrackIds.has(candidate.trackId) || matchedDetectionIndexes.has(candidate.detectionIndex)) {
        continue
      }

      const previous = this.tracks.get(candidate.trackId)
      const detection = normalizedDetections[candidate.detectionIndex]
      if (!previous || !detection) {
        continue
      }

      matchedTrackIds.add(candidate.trackId)
      matchedDetectionIndexes.add(candidate.detectionIndex)

      const currentCenterY = detection.top + detection.height / 2
      const currentCenterX = detection.left + detection.width / 2
      const previousCenterX = previous.boundingBox.left + previous.boundingBox.width / 2
      const currentBottomY = detection.top + detection.height
      const crossedLine =
        previous.previousBottomY < countingLinePosition &&
        currentBottomY >= countingLinePosition &&
        previous.framesVisible + 1 >= this.options.minVisibleFramesBeforeCounting

      const vehicleClass = detection.confidence >= previous.maxConfidence ? detection.vehicleClass : previous.vehicleClass
      const confidence = Math.max(previous.confidence, detection.confidence)
      const updatedTrack: TrackedVehicle = {
        trackId: candidate.trackId,
        vehicleClass,
        confidence,
        boundingBox: detection,
        framesVisible: previous.framesVisible + 1,
        missedFrames: 0,
        framesSinceCounted: previous.counted ? previous.framesSinceCounted + 1 : 0,
        velocityX: smoothVelocity(previous.velocityX, currentCenterX - previousCenterX),
        velocityY: smoothVelocity(previous.velocityY, currentCenterY - previous.previousCenterY),
        previousCenterY: currentCenterY,
        previousBottomY: currentBottomY,
        maxBottomY: Math.max(previous.maxBottomY, currentBottomY),
        maxConfidence: Math.max(previous.maxConfidence, detection.confidence),
        counted: previous.counted,
      }
      const shouldCount =
        !previous.counted &&
        (crossedLine || isStableVehicleTrack(updatedTrack)) &&
        !this.matchesRecentlyCounted(updatedTrack)

      if (shouldCount) {
        newlyCountedClasses.push(vehicleClass)
        this.rememberCountedFootprint(updatedTrack)
      }
      if (previous.counted) {
        this.rememberCountedFootprint(updatedTrack)
      }

      updatedTracks.set(candidate.trackId, {
        ...updatedTrack,
        counted: previous.counted || shouldCount,
        framesSinceCounted: previous.counted || shouldCount ? previous.framesSinceCounted + 1 : 0,
      })
    }

    normalizedDetections.forEach((detection, detectionIndex) => {
      if (matchedDetectionIndexes.has(detectionIndex)) {
        return
      }

      const currentBottomY = detection.top + detection.height
      const currentCenterY = detection.top + detection.height / 2
      const newTrackId = this.nextTrackId++

      updatedTracks.set(newTrackId, {
        trackId: newTrackId,
        vehicleClass: detection.vehicleClass,
        confidence: detection.confidence,
        boundingBox: detection,
        framesVisible: 1,
        missedFrames: 0,
        framesSinceCounted: 0,
        velocityX: 0,
        velocityY: 0,
        previousCenterY: currentCenterY,
        previousBottomY: currentBottomY,
        maxBottomY: currentBottomY,
        maxConfidence: detection.confidence,
        counted: false,
      })
    })

    for (const [trackId, previous] of this.tracks.entries()) {
      if (matchedTrackIds.has(trackId)) {
        continue
      }

      const missedFrames = previous.missedFrames + 1
      if (missedFrames > this.options.maxMissedFrames) {
        if (shouldCountOnExit(previous, this.options.minVisibleFramesBeforeCounting) && !this.matchesRecentlyCounted(previous)) {
          newlyCountedClasses.push(previous.vehicleClass)
          this.rememberCountedFootprint(previous)
        }
        continue
      }

      updatedTracks.set(trackId, {
        ...advancePredictedTrack(previous),
        missedFrames,
        framesSinceCounted: previous.counted ? previous.framesSinceCounted + 1 : previous.framesSinceCounted,
      })
    }

    this.tracks = updatedTracks

    return {
      activeTracks: visibleTracks(updatedTracks),
      newlyCountedClasses,
    }
  }

  flush(): TrackingUpdate {
    const newlyCountedClasses: TrackedVehicle['vehicleClass'][] = []

    for (const track of this.tracks.values()) {
      if (shouldCountOnExit(track, this.options.minVisibleFramesBeforeCounting) && !this.matchesRecentlyCounted(track)) {
        newlyCountedClasses.push(track.vehicleClass)
      }
    }

    this.tracks.clear()
    this.countedFootprints = []

    return {
      activeTracks: [],
      newlyCountedClasses,
    }
  }

  private decayCountedFootprints() {
    this.countedFootprints = this.countedFootprints
      .map((entry) => ({ ...entry, ttl: entry.ttl - 1 }))
      .filter((entry) => entry.ttl > 0)
  }

  private rememberCountedFootprint(track: TrackedVehicle) {
    this.countedFootprints = this.countedFootprints.filter((entry) => entry.trackId !== track.trackId)
    this.countedFootprints.push({
      trackId: track.trackId,
      boundingBox: track.boundingBox,
      vehicleClass: track.vehicleClass,
      ttl: 32,
    })
  }

  private matchesRecentlyCounted(track: TrackedVehicle) {
    return this.countedFootprints.some((entry) => {
      if (entry.vehicleClass !== track.vehicleClass) {
        return false
      }

      const iou = intersectionOverUnion(entry.boundingBox, track.boundingBox)
      const distance = centerDistance(entry.boundingBox, track.boundingBox)
      return iou >= 0.12 || distance <= this.options.maxCenterDistance * 0.75
    })
  }
}

function suppressDuplicateDetections(detections: DetectionBox[]) {
  const sorted = [...detections].sort((left, right) => right.confidence - left.confidence)
  const kept: DetectionBox[] = []

  for (const detection of sorted) {
    const duplicatesExisting = kept.some((existing) => areDuplicateDetections(existing, detection))
    if (!duplicatesExisting) {
      kept.push(detection)
    }
  }

  return kept
}

function areDuplicateDetections(left: DetectionBox, right: DetectionBox) {
  const iou = intersectionOverUnion(left, right)
  const sameClass = left.vehicleClass === right.vehicleClass
  if (!sameClass && iou < 0.62) {
    return false
  }

  if (iou >= 0.38) {
    return true
  }

  const distance = centerDistance(left, right)
  const sizeScale = Math.max(
    0.025,
    Math.min(left.width, right.width) * 0.45 + Math.min(left.height, right.height) * 0.45,
  )
  if (distance > sizeScale) {
    return false
  }

  return containmentRatio(left, right) >= 0.55 || containmentRatio(right, left) >= 0.55
}

function containmentRatio(inner: DetectionBox, outer: DetectionBox) {
  const overlapLeft = Math.max(inner.left, outer.left)
  const overlapTop = Math.max(inner.top, outer.top)
  const overlapRight = Math.min(inner.left + inner.width, outer.left + outer.width)
  const overlapBottom = Math.min(inner.top + inner.height, outer.top + outer.height)

  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    return 0
  }

  const intersection = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  const innerArea = detectionArea(inner)
  return innerArea > 0 ? intersection / innerArea : 0
}

function resolveOptions(options: VehicleTrackerOptions): ResolvedVehicleTrackerOptions {
  return {
    maxCenterDistance: options.maxCenterDistance ?? 0.22,
    maxMissedFrames: options.maxMissedFrames ?? 14,
    minVisibleFramesBeforeCounting: options.minVisibleFramesBeforeCounting ?? 3,
    exitCountSlack: options.exitCountSlack ?? 0.22,
    minIoUForDirectMatch: options.minIoUForDirectMatch ?? 0.05,
    countedTrackReleaseDistance: options.countedTrackReleaseDistance ?? 0.12,
  }
}

function buildMatchCandidates({
  tracks,
  detections,
  maxCenterDistance,
  minIoUForDirectMatch,
}: {
  tracks: TrackedVehicle[]
  detections: DetectionBox[]
  maxCenterDistance: number
  minIoUForDirectMatch: number
}) {
  const candidates: MatchCandidate[] = []

  for (const track of tracks) {
    const predictedTrackBox = predictBoundingBox(track)
    for (const [detectionIndex, detection] of detections.entries()) {
      const iou = intersectionOverUnion(predictedTrackBox, detection)
      const distance = centerDistance(predictedTrackBox, detection)
      const sameClassBonus = track.vehicleClass === detection.vehicleClass ? 0.08 : 0
      const countedTrackPenalty = track.counted ? 0.03 : 0

      if (iou < minIoUForDirectMatch && distance > maxCenterDistance) {
        continue
      }

      const distanceScore = Math.max(0, 1 - distance / maxCenterDistance)
      const score = iou * 0.78 + distanceScore * 0.2 + sameClassBonus - countedTrackPenalty

      candidates.push({
        trackId: track.trackId,
        detectionIndex,
        score,
      })
    }
  }

  return candidates.sort((left, right) => right.score - left.score)
}

function shouldCountOnExit(
  track: TrackedVehicle,
  minVisibleFramesBeforeCounting: number,
) {
  return (
    !track.counted &&
    track.framesVisible >= minVisibleFramesBeforeCounting &&
    track.maxConfidence >= 0.18 &&
    detectionArea(track.boundingBox) >= 0.00025
  )
}

function isStableVehicleTrack(track: TrackedVehicle) {
  return (
    track.framesVisible >= 3 &&
    track.maxConfidence >= 0.18 &&
    (track.maxConfidence >= 0.24 || detectionArea(track.boundingBox) >= 0.00035)
  )
}

function smoothVelocity(previousVelocity: number, nextVelocity: number) {
  return previousVelocity * 0.55 + nextVelocity * 0.45
}

function predictBoundingBox(track: TrackedVehicle) {
  const steps = Math.min(track.missedFrames + 1, 4)
  return shiftBoundingBox(track.boundingBox, track.velocityX * steps, track.velocityY * steps)
}

function advancePredictedTrack(track: TrackedVehicle) {
  return {
    ...track,
    boundingBox: predictBoundingBox(track),
    previousCenterY: track.previousCenterY + track.velocityY,
    previousBottomY: track.previousBottomY + track.velocityY,
    maxBottomY: Math.max(track.maxBottomY, track.previousBottomY + track.velocityY),
  }
}

function shiftBoundingBox(detection: DetectionBox, dx: number, dy: number) {
  return {
    ...detection,
    left: clamp01(detection.left + dx),
    top: clamp01(detection.top + dy),
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function detectionArea(detection: DetectionBox) {
  return detection.width * detection.height
}

function visibleTracks(tracks: Map<number, TrackedVehicle>) {
  return [...tracks.values()]
    .filter((track) => track.missedFrames === 0)
    .sort((left, right) => left.trackId - right.trackId)
}

function centerDistance(left: DetectionBox, right: DetectionBox) {
  const leftCenterX = left.left + left.width / 2
  const leftCenterY = left.top + left.height / 2
  const rightCenterX = right.left + right.width / 2
  const rightCenterY = right.top + right.height / 2
  const dx = leftCenterX - rightCenterX
  const dy = leftCenterY - rightCenterY
  return Math.sqrt(dx * dx + dy * dy)
}

function intersectionOverUnion(left: DetectionBox, right: DetectionBox) {
  const overlapLeft = Math.max(left.left, right.left)
  const overlapTop = Math.max(left.top, right.top)
  const overlapRight = Math.min(left.left + left.width, right.left + right.width)
  const overlapBottom = Math.min(left.top + left.height, right.top + right.height)

  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    return 0
  }

  const intersection = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}
