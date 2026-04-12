# YOLO Mobile Integration Notes

## Intended pipeline

1. Fine-tune a small YOLO model on roadside traffic data with these labels:
   - `car`
   - `SUV`
   - `van`
   - `truck`
   - `bus`
   - `motorcycle`
2. Benchmark the smallest acceptable model first.
3. Export the selected model to ONNX.
4. Run ONNX Runtime Mobile in native Android and iOS code.
5. Send raw detections through the Flutter event channel.
6. Let the Flutter-side tracker handle track identity, line crossing, and session counts.

## Example training/export commands

These commands are examples for a future training machine with Python and Ultralytics installed:

```bash
yolo detect train data=traffic.yaml model=yolo11n.pt imgsz=640 epochs=100 batch=16
yolo detect val model=runs/detect/train/weights/best.pt data=traffic.yaml
yolo export model=runs/detect/train/weights/best.pt format=onnx imgsz=640
```

## Runtime notes

- Keep the detector swappable so TFLite can be tested later.
- Start with CPU inference on-device, then add NNAPI / Core ML execution providers if needed.
- Normalize native output into the event payload shape documented in the root `README.md`.
- Keep tracking/counting in Flutter until there is clear evidence it needs to move native-side.
- The React web app under `web/` uses a matching browser-side analyzer contract and can load an ONNX model through `onnxruntime-web`.
