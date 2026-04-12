import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/inference_config.dart';
import '../models/inference_frame.dart';
import '../models/scan_session_summary.dart';
import '../models/session_mode.dart';
import '../models/tracked_vehicle.dart';
import '../models/vehicle_class.dart';
import '../services/vehicle_inference_service.dart';
import '../services/vehicle_tracker.dart';

class ScanSessionController extends ChangeNotifier {
  ScanSessionController({
    required VehicleInferenceService inferenceService,
    required InferenceConfig initialConfig,
  })  : _inferenceService = inferenceService,
        _config = initialConfig {
    _counts = {
      for (final vehicleClass in VehicleClass.values) vehicleClass: 0,
    };
  }

  final VehicleInferenceService _inferenceService;
  final VehicleTracker _tracker = VehicleTracker();

  InferenceConfig _config;
  StreamSubscription<InferenceFrame>? _subscription;
  Timer? _elapsedTimer;
  DateTime? _sessionStartedAt;
  DateTime? _sessionEndedAt;
  SessionMode? _mode;
  bool _isRunning = false;
  bool _isInitializing = false;
  String? _selectedVideoPath;
  List<TrackedVehicle> _activeTracks = const [];
  Map<VehicleClass, int> _counts = {};
  Duration _elapsed = Duration.zero;
  bool _usedMockInference = false;
  String? _lastError;

  InferenceConfig get config => _config;
  SessionMode? get mode => _mode;
  bool get isRunning => _isRunning;
  bool get isInitializing => _isInitializing;
  String? get selectedVideoPath => _selectedVideoPath;
  List<TrackedVehicle> get activeTracks => _activeTracks;
  Map<VehicleClass, int> get counts => Map.unmodifiable(_counts);
  Duration get elapsed => _elapsed;
  bool get usedMockInference => _usedMockInference;
  String? get lastError => _lastError;

  int get totalVehicles =>
      _counts.values.fold<int>(0, (sum, count) => sum + count);

  Future<void> startLiveSession() async {
    _mode = SessionMode.live;
    _selectedVideoPath = null;
    await _start(() => _inferenceService.startLive());
  }

  Future<void> startVideoSession(String videoPath) async {
    _mode = SessionMode.video;
    _selectedVideoPath = videoPath;
    await _start(() => _inferenceService.analyzeVideo(videoPath));
  }

  Future<void> _start(Stream<InferenceFrame> Function() streamFactory) async {
    _lastError = null;
    _isInitializing = true;
    notifyListeners();

    await stop();
    _resetSessionState();

    try {
      await _inferenceService.initialize(_config);
      _usedMockInference = _inferenceService.isUsingMock;
      _sessionStartedAt = DateTime.now();
      _sessionEndedAt = null;
      _subscription = streamFactory().listen(
        _handleFrame,
        onError: (Object error) {
          _lastError = error.toString();
          _isRunning = false;
          notifyListeners();
        },
        onDone: () {
          _isRunning = false;
          _sessionEndedAt = DateTime.now();
          notifyListeners();
        },
      );
      _isRunning = true;
      _startElapsedTimer();
    } catch (error) {
      _lastError = error.toString();
      _isRunning = false;
    } finally {
      _isInitializing = false;
      notifyListeners();
    }
  }

  void _handleFrame(InferenceFrame frame) {
    final update = _tracker.update(
      detections: frame.detections,
      timestampMs: frame.timestampMs,
      countingLinePosition: _config.countingLinePosition,
    );
    _activeTracks = update.activeTracks;
    for (final countedTrackId in update.newlyCountedTrackIds) {
      final track = _activeTracks.firstWhere((entry) => entry.trackId == countedTrackId);
      _counts[track.vehicleClass] = (_counts[track.vehicleClass] ?? 0) + 1;
    }
    notifyListeners();
  }

  Future<void> stop() async {
    _isRunning = false;
    _elapsedTimer?.cancel();
    _elapsedTimer = null;
    await _subscription?.cancel();
    _subscription = null;
    await _inferenceService.stop();
    _sessionEndedAt ??= DateTime.now();
    notifyListeners();
  }

  void reset() {
    _mode = null;
    _selectedVideoPath = null;
    _lastError = null;
    _sessionStartedAt = null;
    _sessionEndedAt = null;
    _usedMockInference = false;
    _resetSessionState();
    notifyListeners();
  }

  void updateConfig(InferenceConfig newConfig) {
    _config = newConfig;
    notifyListeners();
  }

  ScanSessionSummary? buildSummary() {
    final startedAt = _sessionStartedAt;
    final endedAt = _sessionEndedAt ?? (_isRunning ? DateTime.now() : null);
    if (startedAt == null || endedAt == null) {
      return null;
    }

    return ScanSessionSummary(
      startedAt: startedAt,
      endedAt: endedAt,
      counts: Map<VehicleClass, int>.from(_counts),
      totalVehicles: totalVehicles,
      usedMockInference: _usedMockInference,
      videoPath: _selectedVideoPath,
    );
  }

  void _resetSessionState() {
    _tracker.reset();
    _counts = {
      for (final vehicleClass in VehicleClass.values) vehicleClass: 0,
    };
    _activeTracks = const [];
    _elapsed = Duration.zero;
  }

  void _startElapsedTimer() {
    _elapsedTimer?.cancel();
    _elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      final startedAt = _sessionStartedAt;
      if (startedAt == null) {
        return;
      }
      _elapsed = DateTime.now().difference(startedAt);
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _elapsedTimer?.cancel();
    _subscription?.cancel();
    _inferenceService.stop();
    super.dispose();
  }
}
