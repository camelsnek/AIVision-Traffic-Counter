import 'dart:io';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

class VideoPreviewPlayer extends StatefulWidget {
  const VideoPreviewPlayer({
    required this.videoPath,
    super.key,
  });

  final String videoPath;

  @override
  State<VideoPreviewPlayer> createState() => _VideoPreviewPlayerState();
}

class _VideoPreviewPlayerState extends State<VideoPreviewPlayer> {
  VideoPlayerController? _controller;
  Future<void>? _initializeFuture;

  @override
  void initState() {
    super.initState();
    _initializeFuture = _initialize();
  }

  Future<void> _initialize() async {
    final controller = VideoPlayerController.file(File(widget.videoPath));
    _controller = controller;
    await controller.initialize();
    await controller.setLooping(true);
    await controller.play();
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final initializeFuture = _initializeFuture;
    if (initializeFuture == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return FutureBuilder<void>(
      future: initializeFuture,
      builder: (context, snapshot) {
        final controller = _controller;
        if (snapshot.hasError) {
          return Center(
            child: Text('Unable to load video: ${snapshot.error}'),
          );
        }
        if (snapshot.connectionState != ConnectionState.done ||
            controller == null ||
            !controller.value.isInitialized) {
          return const Center(child: CircularProgressIndicator());
        }

        return ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: AspectRatio(
            aspectRatio: controller.value.aspectRatio,
            child: VideoPlayer(controller),
          ),
        );
      },
    );
  }
}
