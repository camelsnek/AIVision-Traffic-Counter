import 'package:ai_vision_traffic_scanner/controllers/scan_session_controller.dart';
import 'package:ai_vision_traffic_scanner/models/detection_box.dart';
import 'package:ai_vision_traffic_scanner/models/inference_config.dart';
import 'package:ai_vision_traffic_scanner/models/inference_frame.dart';
import 'package:ai_vision_traffic_scanner/models/vehicle_class.dart';
import 'package:ai_vision_traffic_scanner/services/vehicle_inference_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('controller updates counts from streamed frames', () async {
    final service = _FakeInferenceService();
    final controller = ScanSessionController(
      inferenceService: service,
      initialConfig: const InferenceConfig(countingLinePosition: 0.5),
    );

    await controller.startLiveSession();
    await Future<void>.delayed(const Duration(milliseconds: 10));
    await controller.stop();

    expect(controller.counts[VehicleClass.car], 1);
    expect(controller.totalVehicles, 1);
    expect(controller.buildSummary(), isNotNull);
  });
}

class _FakeInferenceService implements VehicleInferenceService {
  @override
  bool get isUsingMock => false;

  @override
  Future<void> initialize(InferenceConfig config) async {}

  @override
  Stream<InferenceFrame> analyzeVideo(String videoPath) {
    return _frames();
  }

  @override
  Stream<InferenceFrame> startLive() {
    return _frames();
  }

  Stream<InferenceFrame> _frames() async* {
    yield const InferenceFrame(
      timestampMs: 1000,
      frameWidth: 1280,
      frameHeight: 720,
      detections: [
        DetectionBox(
          vehicleClass: VehicleClass.car,
          confidence: 0.9,
          left: 0.2,
          top: 0.2,
          width: 0.2,
          height: 0.1,
        ),
      ],
    );
    yield const InferenceFrame(
      timestampMs: 1200,
      frameWidth: 1280,
      frameHeight: 720,
      detections: [
        DetectionBox(
          vehicleClass: VehicleClass.car,
          confidence: 0.9,
          left: 0.2,
          top: 0.48,
          width: 0.2,
          height: 0.1,
        ),
      ],
    );
  }

  @override
  Future<void> stop() async {}
}
