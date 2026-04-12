import 'package:flutter/material.dart';

import '../models/vehicle_class.dart';

class SessionStatsPanel extends StatelessWidget {
  const SessionStatsPanel({
    required this.counts,
    required this.elapsedLabel,
    required this.isUsingMock,
    super.key,
  });

  final Map<VehicleClass, int> counts;
  final String elapsedLabel;
  final bool isUsingMock;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Session Stats', style: theme.textTheme.titleMedium),
                const Spacer(),
                Chip(
                  label: Text(isUsingMock ? 'Mock Inference' : 'Native Inference'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Elapsed: $elapsedLabel',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: counts.entries
                  .map(
                    (entry) => Chip(
                      label: Text('${entry.key.label}: ${entry.value}'),
                    ),
                  )
                  .toList(growable: false),
            ),
          ],
        ),
      ),
    );
  }
}
