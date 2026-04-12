import 'package:flutter/material.dart';

import '../controllers/scan_session_controller.dart';
import '../widgets/detection_overlay.dart';
import '../widgets/live_camera_preview.dart';
import '../widgets/session_stats_panel.dart';
import 'results_screen.dart';

class LiveScanScreen extends StatelessWidget {
  const LiveScanScreen({
    required this.controller,
    super.key,
  });

  final ScanSessionController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        return Scaffold(
          appBar: AppBar(
            title: const Text('Live Camera Scan'),
            actions: [
              TextButton(
                onPressed: controller.isRunning
                    ? () async {
                        await controller.stop();
                        if (!context.mounted) {
                          return;
                        }
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
                    const LiveCameraPreview(),
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
                    onPressed: controller.isInitializing || controller.isRunning
                        ? null
                        : () async {
                            await controller.startLiveSession();
                          },
                    icon: const Icon(Icons.play_arrow),
                    label: Text(controller.isInitializing ? 'Initializing...' : 'Start'),
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

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    final hours = duration.inHours.toString().padLeft(2, '0');
    return '$hours:$minutes:$seconds';
  }
}
