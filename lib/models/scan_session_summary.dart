import 'vehicle_class.dart';

class ScanSessionSummary {
  const ScanSessionSummary({
    required this.startedAt,
    required this.endedAt,
    required this.counts,
    required this.totalVehicles,
    required this.usedMockInference,
    this.videoPath,
  });

  final DateTime startedAt;
  final DateTime endedAt;
  final Map<VehicleClass, int> counts;
  final int totalVehicles;
  final bool usedMockInference;
  final String? videoPath;
}
