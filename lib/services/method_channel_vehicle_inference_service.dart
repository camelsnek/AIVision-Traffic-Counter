import 'package:flutter/services.dart';

import '../models/inference_config.dart';
import '../models/inference_frame.dart';
import 'vehicle_inference_service.dart';

class MethodChannelVehicleInferenceService implements VehicleInferenceService {
  MethodChannelVehicleInferenceService({required VehicleInferenceService fallback})
      : _fallback = fallback;

  static const _methodChannel = MethodChannel('ai_vision_traffic_scanner/inference');
  static const _eventChannel = EventChannel('ai_vision_traffic_scanner/inference_stream');

  final VehicleInferenceService _fallback;
  bool _nativeAvailable = true;
  bool _usingFallback = false;

  @override
  bool get isUsingMock => _usingFallback && _fallback.isUsingMock;

  @override
  Future<void> initialize(InferenceConfig config) async {
    await _fallback.initialize(config);
    try {
      await _methodChannel.invokeMethod<void>('loadModel', config.toJson());
      _nativeAvailable = true;
      _usingFallback = false;
    } on MissingPluginException {
      _nativeAvailable = false;
      _usingFallback = true;
    } on PlatformException {
      _nativeAvailable = false;
      _usingFallback = true;
    }
  }

  @override
  Stream<InferenceFrame> analyzeVideo(String videoPath) {
    if (!_nativeAvailable) {
      return _fallback.analyzeVideo(videoPath);
    }

    return _startNativeStream(
      method: 'analyzeVideoFile',
      arguments: {'videoPath': videoPath},
    );
  }

  @override
  Stream<InferenceFrame> startLive() {
    if (!_nativeAvailable) {
      return _fallback.startLive();
    }

    return _startNativeStream(method: 'startLiveInference');
  }

  Stream<InferenceFrame> _startNativeStream({
    required String method,
    Map<String, Object?>? arguments,
  }) async* {
    try {
      await _methodChannel.invokeMethod<void>(method, arguments);
      yield* _eventChannel
          .receiveBroadcastStream()
          .where((event) => event is Map<Object?, Object?>)
          .cast<Map<Object?, Object?>>()
          .map(InferenceFrame.fromJson);
    } on MissingPluginException {
      _nativeAvailable = false;
      _usingFallback = true;
      if (method == 'analyzeVideoFile') {
        yield* _fallback.analyzeVideo('${arguments?['videoPath'] ?? ''}');
      } else {
        yield* _fallback.startLive();
      }
    } on PlatformException {
      _nativeAvailable = false;
      _usingFallback = true;
      if (method == 'analyzeVideoFile') {
        yield* _fallback.analyzeVideo('${arguments?['videoPath'] ?? ''}');
      } else {
        yield* _fallback.startLive();
      }
    }
  }

  @override
  Future<void> stop() async {
    if (_nativeAvailable) {
      try {
        await _methodChannel.invokeMethod<void>('stopInference');
        return;
      } on MissingPluginException {
        _nativeAvailable = false;
        _usingFallback = true;
      } on PlatformException {
        _nativeAvailable = false;
        _usingFallback = true;
      }
    }
    await _fallback.stop();
  }
}
