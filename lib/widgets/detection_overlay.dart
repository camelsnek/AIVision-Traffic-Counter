import 'package:flutter/material.dart';

import '../models/tracked_vehicle.dart';
import '../models/vehicle_class.dart';

class DetectionOverlay extends StatelessWidget {
  const DetectionOverlay({
    required this.tracks,
    required this.countingLinePosition,
    super.key,
  });

  final List<TrackedVehicle> tracks;
  final double countingLinePosition;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DetectionOverlayPainter(
        tracks: tracks,
        countingLinePosition: countingLinePosition,
      ),
      child: const SizedBox.expand(),
    );
  }
}

class _DetectionOverlayPainter extends CustomPainter {
  const _DetectionOverlayPainter({
    required this.tracks,
    required this.countingLinePosition,
  });

  final List<TrackedVehicle> tracks;
  final double countingLinePosition;

  @override
  void paint(Canvas canvas, Size size) {
    final linePaint = Paint()
      ..color = const Color(0xFFFF6F3C)
      ..strokeWidth = 3;

    final lineY = size.height * countingLinePosition;
    canvas.drawLine(Offset(0, lineY), Offset(size.width, lineY), linePaint);

    for (final track in tracks) {
      final rect = Rect.fromLTWH(
        track.boundingBox.left * size.width,
        track.boundingBox.top * size.height,
        track.boundingBox.width * size.width,
        track.boundingBox.height * size.height,
      );

      final color = _colorForVehicleClass(track.vehicleClass);
      final boxPaint = Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3;
      canvas.drawRect(rect, boxPaint);

      final label = '${track.vehicleClass.label} #${track.trackId}'
          '${track.counted ? ' COUNTED' : ''}';
      final textSpan = TextSpan(
        text: label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w700,
          backgroundColor: Colors.black.withAlpha(110),
        ),
      );
      final textPainter = TextPainter(
        text: textSpan,
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: size.width * 0.8);

      final textTop = (rect.top - textPainter.height - 4)
          .clamp(0.0, size.height)
          .toDouble();
      textPainter.paint(canvas, Offset(rect.left, textTop));
    }
  }

  Color _colorForVehicleClass(VehicleClass vehicleClass) {
    switch (vehicleClass) {
      case VehicleClass.car:
        return const Color(0xFF2A9D8F);
      case VehicleClass.suv:
        return const Color(0xFFE9C46A);
      case VehicleClass.van:
        return const Color(0xFF264653);
      case VehicleClass.truck:
        return const Color(0xFFD62828);
      case VehicleClass.bus:
        return const Color(0xFF6A4C93);
      case VehicleClass.motorcycle:
        return const Color(0xFF1D3557);
    }
  }

  @override
  bool shouldRepaint(covariant _DetectionOverlayPainter oldDelegate) {
    return oldDelegate.tracks != tracks ||
        oldDelegate.countingLinePosition != countingLinePosition;
  }
}
