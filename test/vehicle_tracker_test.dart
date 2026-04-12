import 'package:ai_vision_traffic_scanner/models/detection_box.dart';
import 'package:ai_vision_traffic_scanner/models/vehicle_class.dart';
import 'package:ai_vision_traffic_scanner/services/vehicle_tracker.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('VehicleTracker', () {
    test('counts a vehicle once when it crosses the counting line', () {
      final tracker = VehicleTracker();

      final first = tracker.update(
        detections: const [
          DetectionBox(
            vehicleClass: VehicleClass.car,
            confidence: 0.9,
            left: 0.2,
            top: 0.2,
            width: 0.2,
            height: 0.1,
          ),
        ],
        timestampMs: 1000,
        countingLinePosition: 0.5,
      );

      expect(first.newlyCountedTrackIds, isEmpty);

      final second = tracker.update(
        detections: const [
          DetectionBox(
            vehicleClass: VehicleClass.car,
            confidence: 0.9,
            left: 0.21,
            top: 0.48,
            width: 0.2,
            height: 0.1,
          ),
        ],
        timestampMs: 1200,
        countingLinePosition: 0.5,
      );

      expect(second.newlyCountedTrackIds, hasLength(1));

      final third = tracker.update(
        detections: const [
          DetectionBox(
            vehicleClass: VehicleClass.car,
            confidence: 0.9,
            left: 0.22,
            top: 0.6,
            width: 0.2,
            height: 0.1,
          ),
        ],
        timestampMs: 1400,
        countingLinePosition: 0.5,
      );

      expect(third.newlyCountedTrackIds, isEmpty);
    });

    test('creates independent counts for separate vehicles', () {
      final tracker = VehicleTracker();

      tracker.update(
        detections: const [
          DetectionBox(
            vehicleClass: VehicleClass.truck,
            confidence: 0.95,
            left: 0.1,
            top: 0.1,
            width: 0.2,
            height: 0.14,
          ),
        ],
        timestampMs: 1000,
        countingLinePosition: 0.6,
      );

      final next = tracker.update(
        detections: const [
          DetectionBox(
            vehicleClass: VehicleClass.truck,
            confidence: 0.94,
            left: 0.1,
            top: 0.62,
            width: 0.2,
            height: 0.14,
          ),
          DetectionBox(
            vehicleClass: VehicleClass.bus,
            confidence: 0.96,
            left: 0.6,
            top: 0.2,
            width: 0.22,
            height: 0.16,
          ),
        ],
        timestampMs: 1200,
        countingLinePosition: 0.6,
      );

      expect(next.newlyCountedTrackIds, hasLength(1));
      expect(next.activeTracks, hasLength(2));
    });
  });
}
