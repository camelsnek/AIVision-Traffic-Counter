import 'dart:async';

import '../models/detection_box.dart';
import '../models/inference_config.dart';
import '../models/inference_frame.dart';
import '../models/vehicle_class.dart';
import 'vehicle_inference_service.dart';

class MockVehicleInferenceService implements VehicleInferenceService {
  Timer? _timer;
  StreamController<InferenceFrame>? _controller;
  InferenceConfig _config = const InferenceConfig();
  int _tick = 0;

  @override
  bool get isUsingMock => true;

  @override
  Future<void> initialize(InferenceConfig config) async {
    _config = config;
  }

  @override
  Stream<InferenceFrame> analyzeVideo(String videoPath) {
    return _startStream(isVideo: true);
  }

  @override
  Stream<InferenceFrame> startLive() {
    return _startStream(isVideo: false);
  }

  Stream<InferenceFrame> _startStream({required bool isVideo}) {
    _controller?.close();
    _timer?.cancel();

    _controller = StreamController<InferenceFrame>.broadcast(
      onCancel: () => _timer?.cancel(),
    );

    _tick = 0;
    _timer = Timer.periodic(const Duration(milliseconds: 250), (_) {
      _tick += 1;
      final detections = _generateDetections(_tick, isVideo: isVideo);
      _controller?.add(
        InferenceFrame(
          timestampMs: DateTime.now().millisecondsSinceEpoch,
          frameWidth: 1280,
          frameHeight: 720,
          detections: detections
              .where((entry) =>
                  entry.confidence >= _config.confidenceThreshold &&
                  _config.enabledClasses.contains(entry.vehicleClass))
              .toList(growable: false),
        ),
      );
    });

    return _controller!.stream;
  }

  List<DetectionBox> _generateDetections(int tick, {required bool isVideo}) {
    final firstY = ((tick % 18) / 18);
    final secondY = (((tick + 8) % 22) / 22);
    final thirdY = (((tick + 13) % 26) / 26);
    final confidenceBonus = isVideo ? 0.04 : 0.0;

    return [
      DetectionBox(
        vehicleClass: VehicleClass.car,
        confidence: 0.86 + confidenceBonus,
        left: 0.22,
        top: firstY * 0.82,
        width: 0.18,
        height: 0.1,
      ),
      DetectionBox(
        vehicleClass: VehicleClass.truck,
        confidence: 0.91,
        left: 0.55,
        top: secondY * 0.78,
        width: 0.22,
        height: 0.14,
      ),
      if (tick.isEven)
        DetectionBox(
          vehicleClass: VehicleClass.motorcycle,
          confidence: 0.74,
          left: 0.7,
          top: thirdY * 0.8,
          width: 0.1,
          height: 0.08,
        ),
    ];
  }

  @override
  Future<void> stop() async {
    _timer?.cancel();
    await _controller?.close();
    _controller = null;
  }
}
