import 'vehicle_class.dart';

class InferenceConfig {
  const InferenceConfig({
    this.confidenceThreshold = 0.45,
    this.iouThreshold = 0.45,
    this.frameSamplingRate = 2,
    this.countingLinePosition = 0.72,
    this.enabledClasses = VehicleClass.values,
    this.useMockIfUnavailable = true,
  });

  final double confidenceThreshold;
  final double iouThreshold;
  final int frameSamplingRate;
  final double countingLinePosition;
  final List<VehicleClass> enabledClasses;
  final bool useMockIfUnavailable;

  Map<String, Object?> toJson() {
    return {
      'confidenceThreshold': confidenceThreshold,
      'iouThreshold': iouThreshold,
      'frameSamplingRate': frameSamplingRate,
      'countingLinePosition': countingLinePosition,
      'enabledClasses': enabledClasses.map((entry) => entry.name).toList(),
    };
  }

  InferenceConfig copyWith({
    double? confidenceThreshold,
    double? iouThreshold,
    int? frameSamplingRate,
    double? countingLinePosition,
    List<VehicleClass>? enabledClasses,
    bool? useMockIfUnavailable,
  }) {
    return InferenceConfig(
      confidenceThreshold: confidenceThreshold ?? this.confidenceThreshold,
      iouThreshold: iouThreshold ?? this.iouThreshold,
      frameSamplingRate: frameSamplingRate ?? this.frameSamplingRate,
      countingLinePosition: countingLinePosition ?? this.countingLinePosition,
      enabledClasses: enabledClasses ?? this.enabledClasses,
      useMockIfUnavailable: useMockIfUnavailable ?? this.useMockIfUnavailable,
    );
  }
}
