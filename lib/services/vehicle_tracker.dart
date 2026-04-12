import 'dart:math' as math;

import '../models/detection_box.dart';
import '../models/tracked_vehicle.dart';

class TrackingUpdate {
  const TrackingUpdate({
    required this.activeTracks,
    required this.newlyCountedTrackIds,
  });

  final List<TrackedVehicle> activeTracks;
  final List<int> newlyCountedTrackIds;
}

class VehicleTracker {
  VehicleTracker({
    this.maxCenterDistance = 0.18,
    this.maxMissedFrames = 5,
    this.minVisibleFramesBeforeCounting = 2,
  });

  final double maxCenterDistance;
  final int maxMissedFrames;
  final int minVisibleFramesBeforeCounting;
  int _nextTrackId = 1;
  final Map<int, TrackedVehicle> _tracks = <int, TrackedVehicle>{};

  TrackingUpdate update({
    required List<DetectionBox> detections,
    required int timestampMs,
    required double countingLinePosition,
  }) {
    final newlyCounted = <int>[];
    final unmatchedTracks = _tracks.keys.toSet();
    final updatedTracks = <int, TrackedVehicle>{};

    for (final detection in detections) {
      int? bestTrackId;
      double bestDistance = double.infinity;

      for (final trackId in unmatchedTracks) {
        final candidate = _tracks[trackId]!;
        final distance = _centerDistance(candidate.boundingBox, detection);
        if (distance < bestDistance && distance <= maxCenterDistance) {
          bestDistance = distance;
          bestTrackId = trackId;
        }
      }

      if (bestTrackId == null) {
        final trackId = _nextTrackId++;
        updatedTracks[trackId] = TrackedVehicle(
          trackId: trackId,
          vehicleClass: detection.vehicleClass,
          confidence: detection.confidence,
          boundingBox: detection,
          framesVisible: 1,
          missedFrames: 0,
          lastTimestampMs: timestampMs,
          previousCenterY: detection.centerY,
          counted: false,
        );
        continue;
      }

      unmatchedTracks.remove(bestTrackId);
      final previous = _tracks[bestTrackId]!;
      var updated = previous.copyWith(
        vehicleClass: detection.vehicleClass,
        confidence: detection.confidence,
        boundingBox: detection,
        framesVisible: previous.framesVisible + 1,
        missedFrames: 0,
        lastTimestampMs: timestampMs,
        previousCenterY: previous.centerY,
      );

      final crossedLine = previous.centerY < countingLinePosition &&
          detection.centerY >= countingLinePosition &&
          updated.framesVisible >= minVisibleFramesBeforeCounting;

      if (!updated.counted && crossedLine) {
        updated = updated.copyWith(counted: true);
        newlyCounted.add(updated.trackId);
      }

      updatedTracks[updated.trackId] = updated;
    }

    for (final trackId in unmatchedTracks) {
      final previous = _tracks[trackId]!;
      final missed = previous.missedFrames + 1;
      if (missed > maxMissedFrames) {
        continue;
      }
      updatedTracks[trackId] = previous.copyWith(
        missedFrames: missed,
        lastTimestampMs: timestampMs,
      );
    }

    _tracks
      ..clear()
      ..addAll(updatedTracks);

    return TrackingUpdate(
      activeTracks: _tracks.values.toList()
        ..sort((a, b) => a.trackId.compareTo(b.trackId)),
      newlyCountedTrackIds: newlyCounted,
    );
  }

  void reset() {
    _tracks.clear();
    _nextTrackId = 1;
  }

  double _centerDistance(DetectionBox left, DetectionBox right) {
    final dx = left.centerX - right.centerX;
    final dy = left.centerY - right.centerY;
    return math.sqrt((dx * dx) + (dy * dy));
  }
}
