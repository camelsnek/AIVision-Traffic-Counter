import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../controllers/scan_session_controller.dart';
import '../widgets/detection_overlay.dart';
import '../widgets/session_stats_panel.dart';
import '../widgets/video_preview_player.dart';
import 'results_screen.dart';

class VideoAnalysisScreen extends StatelessWidget {
  const VideoAnalysisScreen({
    required this.controller,
    super.key,
  });

  final ScanSessionController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final videoPath = controller.selectedVideoPath;

        return Scaffold(
          appBar: AppBar(
            title: const Text('Analyze Video'),
            actions: [
              TextButton(
                onPressed: controller.totalVehicles > 0 || !controller.isRunning
                    ? () {
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => ResultsScreen(controller: controller),
                          ),
                        );
                      }
                    : null,
                child: const Text('Results'),
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (videoPath != null)
                      VideoPreviewPlayer(videoPath: videoPath)
                    else
                      const _VideoPlaceholder(),
                    DetectionOverlay(
                      tracks: controller.activeTracks,
                      countingLinePosition: controller.config.countingLinePosition,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SessionStatsPanel(
                counts: controller.counts,
                elapsedLabel: _formatDuration(controller.elapsed),
                isUsingMock: controller.usedMockInference,
              ),
              if (videoPath != null) ...[
                const SizedBox(height: 12),
                Text('Selected video: $videoPath'),
              ],
              if (controller.lastError != null) ...[
                const SizedBox(height: 12),
                Text(
                  controller.lastError!,
                  style: const TextStyle(color: Colors.red),
                ),
              ],
              const SizedBox(height: 16),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  FilledButton.icon(
                    onPressed: controller.isInitializing
                        ? null
                        : () async {
                            await _pickAndStart(context);
                          },
                    icon: const Icon(Icons.video_file),
                    label: const Text('Pick Video'),
                  ),
                  OutlinedButton.icon(
                    onPressed: controller.isRunning
                        ? () async {
                            await controller.stop();
                          }
                        : null,
                    icon: const Icon(Icons.pause_circle_outline),
                    label: const Text('Stop'),
                  ),
                  OutlinedButton.icon(
                    onPressed: controller.reset,
                    icon: const Icon(Icons.replay),
                    label: const Text('Reset'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _pickAndStart(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(type: FileType.video);
    final path = result?.files.single.path;
    if (path == null) {
      return;
    }

    await controller.startVideoSession(path);

    if (!context.mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Video analysis started')),
    );
  }

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    final hours = duration.inHours.toString().padLeft(2, '0');
    return '$hours:$minutes:$seconds';
  }
}

class _VideoPlaceholder extends StatelessWidget {
  const _VideoPlaceholder();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          colors: [Color(0xFF3A506B), Color(0xFF5BC0BE)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Pick a local road video to begin analysis.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}
