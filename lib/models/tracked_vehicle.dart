import 'detection_box.dart';
import 'vehicle_class.dart';

class TrackedVehicle {
  const TrackedVehicle({
    required this.trackId,
    required this.vehicleClass,
    required this.confidence,
    required this.boundingBox,
    required this.framesVisible,
    required this.missedFrames,
    required this.lastTimestampMs,
    required this.previousCenterY,
    required this.counted,
  });

  final int trackId;
  final VehicleClass vehicleClass;
  final double confidence;
  final DetectionBox boundingBox;
  final int framesVisible;
  final int missedFrames;
  final int lastTimestampMs;
  final double previousCenterY;
  final bool counted;

  double get centerY => boundingBox.centerY;

  TrackedVehicle copyWith({
    int? trackId,
    VehicleClass? vehicleClass,
    double? confidence,
    DetectionBox? boundingBox,
    int? framesVisible,
    int? missedFrames,
    int? lastTimestampMs,
    double? previousCenterY,
    bool? counted,
  }) {
    return TrackedVehicle(
      trackId: trackId ?? this.trackId,
      vehicleClass: vehicleClass ?? this.vehicleClass,
      confidence: confidence ?? this.confidence,
      boundingBox: boundingBox ?? this.boundingBox,
      framesVisible: framesVisible ?? this.framesVisible,
      missedFrames: missedFrames ?? this.missedFrames,
      lastTimestampMs: lastTimestampMs ?? this.lastTimestampMs,
      previousCenterY: previousCenterY ?? this.previousCenterY,
      counted: counted ?? this.counted,
    );
  }
}
