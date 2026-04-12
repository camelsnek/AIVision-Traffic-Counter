import 'package:flutter/material.dart';

import '../controllers/scan_session_controller.dart';
import 'live_scan_screen.dart';
import 'video_analysis_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    required this.controller,
    super.key,
  });

  final ScanSessionController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFFD8F3DC), Color(0xFFF5F7F4)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final isCompact = constraints.maxWidth < 640;

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'AI Vision Traffic Scanner',
                          style: theme.textTheme.displaySmall?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'Detect, track, and count passing vehicles from live camera or imported road footage.',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 32),
                        Expanded(
                          child: Flex(
                            direction: isCompact ? Axis.vertical : Axis.horizontal,
                            children: [
                              Expanded(
                                child: _HomeCard(
                                  title: 'Live Camera',
                                  description:
                                      'Use the phone camera for roadside scanning with live overlays and session counts.',
                                  buttonLabel: 'Open Live Scan',
                                  onPressed: () {
                                    Navigator.of(context).push(
                                      MaterialPageRoute<void>(
                                        builder: (_) => LiveScanScreen(controller: controller),
                                      ),
                                    );
                                  },
                                ),
                              ),
                              SizedBox(width: isCompact ? 0 : 16, height: isCompact ? 16 : 0),
                              Expanded(
                                child: _HomeCard(
                                  title: 'Analyze Video',
                                  description:
                                      'Import a local video clip and review detections, tracks, and totals.',
                                  buttonLabel: 'Open Video Analysis',
                                  onPressed: () {
                                    Navigator.of(context).push(
                                      MaterialPageRoute<void>(
                                        builder: (_) => VideoAnalysisScreen(controller: controller),
                                      ),
                                    );
                                  },
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HomeCard extends StatelessWidget {
  const _HomeCard({
    required this.title,
    required this.description,
    required this.buttonLabel,
    required this.onPressed,
  });

  final String title;
  final String description;
  final String buttonLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const Spacer(),
            Text(description, style: theme.textTheme.bodyLarge),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: onPressed,
              child: Text(buttonLabel),
            ),
          ],
        ),
      ),
    );
  }
}
