import 'detection_box.dart';

class InferenceFrame {
  const InferenceFrame({
    required this.timestampMs,
    required this.frameWidth,
    required this.frameHeight,
    required this.detections,
  });

  final int timestampMs;
  final int frameWidth;
  final int frameHeight;
  final List<DetectionBox> detections;

  factory InferenceFrame.fromJson(Map<Object?, Object?> json) {
    final rawDetections = (json['detections'] as List<Object?>? ?? const [])
        .whereType<Map<Object?, Object?>>()
        .map(DetectionBox.fromJson)
        .toList(growable: false);

    return InferenceFrame(
      timestampMs: (json['timestampMs'] as num?)?.toInt() ?? 0,
      frameWidth: (json['frameWidth'] as num?)?.toInt() ?? 0,
      frameHeight: (json['frameHeight'] as num?)?.toInt() ?? 0,
      detections: rawDetections,
    );
  }
}
