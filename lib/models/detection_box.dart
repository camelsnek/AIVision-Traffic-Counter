import 'dart:math' as math;

import 'vehicle_class.dart';

class DetectionBox {
  const DetectionBox({
    required this.vehicleClass,
    required this.confidence,
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  final VehicleClass vehicleClass;
  final double confidence;
  final double left;
  final double top;
  final double width;
  final double height;

  double get right => left + width;
  double get bottom => top + height;
  double get centerX => left + (width / 2);
  double get centerY => top + (height / 2);
  double get area => width * height;

  double iou(DetectionBox other) {
    final overlapLeft = math.max(left, other.left);
    final overlapTop = math.max(top, other.top);
    final overlapRight = math.min(right, other.right);
    final overlapBottom = math.min(bottom, other.bottom);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
      return 0;
    }
    final intersection = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
    final union = area + other.area - intersection;
    if (union <= 0) {
      return 0;
    }
    return intersection / union;
  }

  Map<String, Object?> toJson() {
    return {
      'className': vehicleClass.name,
      'confidence': confidence,
      'left': left,
      'top': top,
      'width': width,
      'height': height,
    };
  }

  factory DetectionBox.fromJson(Map<Object?, Object?> json) {
    return DetectionBox(
      vehicleClass: VehicleClass.fromWireValue('${json['className']}'),
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      left: (json['left'] as num?)?.toDouble() ?? 0,
      top: (json['top'] as num?)?.toDouble() ?? 0,
      width: (json['width'] as num?)?.toDouble() ?? 0,
      height: (json['height'] as num?)?.toDouble() ?? 0,
    );
  }
}
