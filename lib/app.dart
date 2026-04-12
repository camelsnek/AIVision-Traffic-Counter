import 'package:flutter/material.dart';

import 'controllers/scan_session_controller.dart';
import 'models/inference_config.dart';
import 'screens/home_screen.dart';
import 'services/method_channel_vehicle_inference_service.dart';
import 'services/mock_vehicle_inference_service.dart';
import 'services/vehicle_inference_service.dart';

class AiVisionApp extends StatefulWidget {
  const AiVisionApp({super.key});

  @override
  State<AiVisionApp> createState() => _AiVisionAppState();
}

class _AiVisionAppState extends State<AiVisionApp> {
  late final VehicleInferenceService _service;
  late final ScanSessionController _controller;

  @override
  void initState() {
    super.initState();
    _service = MethodChannelVehicleInferenceService(
      fallback: MockVehicleInferenceService(),
    );
    _controller = ScanSessionController(
      inferenceService: _service,
      initialConfig: const InferenceConfig(),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI Vision Traffic Scanner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0A6C74),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFF5F7F4),
        useMaterial3: true,
      ),
      home: HomeScreen(controller: _controller),
    );
  }
}
