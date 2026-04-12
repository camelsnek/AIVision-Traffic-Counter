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

export class VehicleTracker {
  private readonly maxCenterDistance: number
  private readonly maxMissedFrames: number
  private readonly minVisibleFramesBeforeCounting: number
  private readonly exitCountSlack: number
  private readonly minIoUForDirectMatch: number
  private readonly maxUpwardDrift: number
  private readonly countedTrackReleaseDistance: number
  private nextTrackId = 1
  private tracks = new Map<number, TrackedVehicle>()

  constructor(
    maxCenterDistance = 0.22,
    maxMissedFrames = 14,
    minVisibleFramesBeforeCounting = 1,
    exitCountSlack = 0.22,
    minIoUForDirectMatch = 0.05,
    maxUpwardDrift = 0.035,
    countedTrackReleaseDistance = 0.12,
  ) {
    this.maxCenterDistance = maxCenterDistance
    this.maxMissedFrames = maxMissedFrames
    this.minVisibleFramesBeforeCounting = minVisibleFramesBeforeCounting
    this.exitCountSlack = exitCountSlack
    this.minIoUForDirectMatch = minIoUForDirectMatch
    this.maxUpwardDrift = maxUpwardDrift
    this.countedTrackReleaseDistance = countedTrackReleaseDistance
  }

  reset() {
    this.nextTrackId = 1
    this.tracks.clear()
  }

  update(detections: DetectionBox[], countingLinePosition: number): TrackingUpdate {
    const updatedTracks = new Map<number, TrackedVehicle>()
    const newlyCountedClasses: TrackedVehicle['vehicleClass'][] = []
    const matchedTrackIds = new Set<number>()
    const matchedDetectionIndexes = new Set<number>()
    const matchCandidates = buildMatchCandidates({
      tracks: [...this.tracks.values()],
      detections,
      maxCenterDistance: this.maxCenterDistance,
      minIoUForDirectMatch: this.minIoUForDirectMatch,
      maxUpwardDrift: this.maxUpwardDrift,
    })

    for (const candidate of matchCandidates) {
      if (matchedTrackIds.has(candidate.trackId) || matchedDetectionIndexes.has(candidate.detectionIndex)) {
        continue
      }

      const previous = this.tracks.get(candidate.trackId)
      const detection = detections[candidate.detectionIndex]
      if (!previous || !detection) {
        continue
      }

      matchedTrackIds.add(candidate.trackId)
      matchedDetectionIndexes.add(candidate.detectionIndex)

      const currentCenterY = detection.top + detection.height / 2
      const currentBottomY = detection.top + detection.height
      const crossedLine =
        previous.previousBottomY < countingLinePosition &&
        currentBottomY >= countingLinePosition &&
        previous.framesVisible + 1 >= this.minVisibleFramesBeforeCounting

      const counted = previous.counted || crossedLine
      const vehicleClass = detection.confidence >= previous.maxConfidence ? detection.vehicleClass : previous.vehicleClass
      const confidence = Math.max(previous.confidence, detection.confidence)

      if (!previous.counted && crossedLine) {
        newlyCountedClasses.push(vehicleClass)
      }

      updatedTracks.set(candidate.trackId, {
        trackId: candidate.trackId,
        vehicleClass,
        confidence,
        boundingBox: detection,
        framesVisible: previous.framesVisible + 1,
        missedFrames: 0,
        framesSinceCounted: counted ? previous.framesSinceCounted + 1 : 0,
        previousCenterY: currentCenterY,
        previousBottomY: currentBottomY,
        maxBottomY: Math.max(previous.maxBottomY, currentBottomY),
        maxConfidence: Math.max(previous.maxConfidence, detection.confidence),
        counted,
      })
    }

    detections.forEach((detection, detectionIndex) => {
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
      if (missedFrames > this.maxMissedFrames) {
        if (shouldCountOnExit(previous, countingLinePosition, this.minVisibleFramesBeforeCounting, this.exitCountSlack)) {
          newlyCountedClasses.push(previous.vehicleClass)
        }
        continue
      }

      if (
        previous.counted &&
        previous.maxBottomY >= countingLinePosition + this.countedTrackReleaseDistance &&
        missedFrames >= 2
      ) {
        continue
      }

      updatedTracks.set(trackId, {
        ...previous,
        missedFrames,
        framesSinceCounted: previous.counted ? previous.framesSinceCounted + 1 : previous.framesSinceCounted,
      })
    }

    this.tracks = updatedTracks

    return {
      activeTracks: [...updatedTracks.values()].sort((left, right) => left.trackId - right.trackId),
      newlyCountedClasses,
    }
  }

  flush(countingLinePosition: number): TrackingUpdate {
    const newlyCountedClasses: TrackedVehicle['vehicleClass'][] = []

    for (const track of this.tracks.values()) {
      if (shouldCountOnExit(track, countingLinePosition, this.minVisibleFramesBeforeCounting, this.exitCountSlack)) {
        newlyCountedClasses.push(track.vehicleClass)
      }
    }

    this.tracks.clear()

    return {
      activeTracks: [],
      newlyCountedClasses,
    }
  }
}

function buildMatchCandidates({
  tracks,
  detections,
  maxCenterDistance,
  minIoUForDirectMatch,
  maxUpwardDrift,
}: {
  tracks: TrackedVehicle[]
  detections: DetectionBox[]
  maxCenterDistance: number
  minIoUForDirectMatch: number
  maxUpwardDrift: number
}) {
  const candidates: MatchCandidate[] = []

  for (const track of tracks) {
    for (const [detectionIndex, detection] of detections.entries()) {
      const iou = intersectionOverUnion(track.boundingBox, detection)
      const distance = centerDistance(track.boundingBox, detection)
      const currentBottomY = detection.top + detection.height
      const upwardDrift = track.previousBottomY - currentBottomY
      const sameClassBonus = track.vehicleClass === detection.vehicleClass ? 0.08 : 0
      const countedTrackPenalty = track.counted ? 0.08 : 0

      if (upwardDrift > maxUpwardDrift) {
        continue
      }

      if (iou < minIoUForDirectMatch && distance > maxCenterDistance) {
        continue
      }

      const distanceScore = Math.max(0, 1 - distance / maxCenterDistance)
      const score = iou * 0.72 + distanceScore * 0.2 + sameClassBonus - countedTrackPenalty

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
  countingLinePosition: number,
  minVisibleFramesBeforeCounting: number,
  exitCountSlack: number,
) {
  return (
    !track.counted &&
    track.framesVisible >= minVisibleFramesBeforeCounting &&
    track.maxBottomY >= countingLinePosition - exitCountSlack &&
    track.maxConfidence >= 0.24
  )
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
