import 'package:flutter/material.dart';

import '../controllers/scan_session_controller.dart';

class ResultsScreen extends StatelessWidget {
  const ResultsScreen({
    required this.controller,
    super.key,
  });

  final ScanSessionController controller;

  @override
  Widget build(BuildContext context) {
    final summary = controller.buildSummary();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Session Results')),
      body: summary == null
          ? const Center(
              child: Text('No session summary is available yet.'),
            )
          : ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  'Total Vehicles: ${summary.totalVehicles}',
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Started: ${summary.startedAt}',
                  style: theme.textTheme.bodyLarge,
                ),
                Text(
                  'Ended: ${summary.endedAt}',
                  style: theme.textTheme.bodyLarge,
                ),
                Text(
                  'Inference: ${summary.usedMockInference ? 'Mock fallback' : 'Native channel'}',
                  style: theme.textTheme.bodyLarge,
                ),
                if (summary.videoPath != null)
                  Text(
                    'Video: ${summary.videoPath}',
                    style: theme.textTheme.bodyLarge,
                  ),
                const SizedBox(height: 20),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: summary.counts.entries
                          .map(
                            (entry) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(entry.key.label),
                              trailing: Text(
                                '${entry.value}',
                                style: theme.textTheme.titleLarge,
                              ),
                            ),
                          )
                          .toList(growable: false),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
