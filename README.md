# AI Vision Traffic Scanner

A Flutter starter app for roadside vehicle detection, tracking, and counting using a YOLO-style mobile inference pipeline.

## What is implemented

- Cross-platform Flutter app shell with:
  - home flow
  - live scan screen
  - imported video analysis screen
  - results screen
- React web app with:
  - local video upload
  - browser-side analysis loop
  - overlay rendering
  - session totals and summary
  - downloaded local YOLOv10n vehicle detector for real testing
- Shared domain models for detections, tracks, config, and session summaries
- Lightweight tracker and one-count-per-vehicle logic
- `VehicleInferenceService` abstraction with:
  - `MethodChannelVehicleInferenceService` for native YOLO/ONNX integration
  - `MockVehicleInferenceService` fallback so the app can still run before the native model is wired in
- Android and iOS native channel stubs for the future ONNX Runtime Mobile integration
- Unit tests for tracker and session behavior

## Current status

This workspace did not have the Flutter SDK installed, so the project was scaffolded manually. The code is structured to be implementation-ready, but it was not generated or verified with `flutter create`, `flutter test`, or a device build in this environment.

The React web app is scaffolded under [web/](C:/Users/KamilRiedl/Desktop/CHAT_GPT/AIVISION/web) and can run independently with Node/Vite.

## Next setup steps

1. Install Flutter and Dart locally.
2. From the project root, run `flutter pub get`.
3. Generate platform build files if desired with `flutter create .`.
4. Merge or preserve the included `android/` and `ios/` native channel stubs if Flutter regenerates those folders.
5. Wire the Android/iOS stubs to ONNX Runtime Mobile and a real exported YOLO model.

## Web app setup

1. Go to [web/package.json](C:/Users/KamilRiedl/Desktop/CHAT_GPT/AIVISION/web/package.json).
2. Run `npm install`.
3. Run `npm run dev`.
4. Open the web UI, choose a road video, and start the scan.

## Native inference contract

Method channel: `ai_vision_traffic_scanner/inference`  
Event channel: `ai_vision_traffic_scanner/inference_stream`

Supported method calls:

- `loadModel`
- `startLiveInference`
- `analyzeVideoFile`
- `stopInference`

Expected event payload:

```json
{
  "timestampMs": 1710000000,
  "frameWidth": 1920,
  "frameHeight": 1080,
  "detections": [
    {
      "className": "car",
      "confidence": 0.91,
      "left": 0.22,
      "top": 0.38,
      "width": 0.15,
      "height": 0.11
    }
  ]
}
```

## Model pipeline

See [docs/yolo_mobile_integration.md](docs/yolo_mobile_integration.md) for the training/export/runtime plan.
