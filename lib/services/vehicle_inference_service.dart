import '../models/inference_config.dart';
import '../models/inference_frame.dart';

abstract class VehicleInferenceService {
  bool get isUsingMock;

  Future<void> initialize(InferenceConfig config);

  Stream<InferenceFrame> startLive();

  Stream<InferenceFrame> analyzeVideo(String videoPath);

  Future<void> stop();
}
