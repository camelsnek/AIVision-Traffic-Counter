import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

class LiveCameraPreview extends StatefulWidget {
  const LiveCameraPreview({super.key});

  @override
  State<LiveCameraPreview> createState() => _LiveCameraPreviewState();
}

class _LiveCameraPreviewState extends State<LiveCameraPreview>
    with WidgetsBindingObserver {
  CameraController? _cameraController;
  CameraDescription? _selectedCamera;
  Future<void>? _initializeFuture;
  bool _permissionOrSetupFailed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initializeFuture = _initialize();
  }

  Future<void> _initialize() async {
    try {
      if (mounted) {
        setState(() => _permissionOrSetupFailed = false);
      } else {
        _permissionOrSetupFailed = false;
      }
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        if (mounted) {
          setState(() => _permissionOrSetupFailed = true);
        } else {
          _permissionOrSetupFailed = true;
        }
        return;
      }

      _selectedCamera = cameras.first;
      final controller = CameraController(
        _selectedCamera!,
        ResolutionPreset.medium,
        enableAudio: false,
      );
      _cameraController = controller;
      await controller.initialize();
      if (mounted) {
        setState(() {});
      }
    } catch (_) {
      if (mounted) {
        setState(() => _permissionOrSetupFailed = true);
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final cameraController = _cameraController;
    if (cameraController == null || !cameraController.value.isInitialized) {
      return;
    }

    if (state == AppLifecycleState.inactive) {
      cameraController.dispose();
      _cameraController = null;
    } else if (state == AppLifecycleState.resumed && _selectedCamera != null) {
      _cameraController = null;
      _initializeFuture = _initialize();
      if (mounted) {
        setState(() {});
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cameraController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final initializeFuture = _initializeFuture;
    if (_permissionOrSetupFailed || initializeFuture == null) {
      return const _CameraPreviewFallback();
    }

    return FutureBuilder<void>(
      future: initializeFuture,
      builder: (context, snapshot) {
        final controller = _cameraController;
        if (snapshot.connectionState != ConnectionState.done ||
            controller == null ||
            !controller.value.isInitialized) {
          return const Center(child: CircularProgressIndicator());
        }

        return ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: CameraPreview(controller),
        );
      },
    );
  }
}

class _CameraPreviewFallback extends StatelessWidget {
  const _CameraPreviewFallback();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          colors: [Color(0xFF264653), Color(0xFF2A9D8F)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Camera preview unavailable in this environment.\n\n'
            'The inference and tracking pipeline can still run through the mock or native service.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}
