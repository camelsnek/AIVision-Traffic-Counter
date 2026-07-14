# AIVision Traffic Counter

This repository contains a complete browser-based traffic counter and a separate Flutter mobile scaffold.

## Web application

The maintained, runnable product is the React + Vite application under [`web/`](web/). It:

- analyzes local video without uploading it;
- runs local YOLOv10 ONNX models through Transformers.js;
- provides explicit Auto, GPU/WebGPU, and CPU/WebAssembly inference controls;
- deterministically samples by video time instead of playback timing;
- tracks vehicles through short detection gaps;
- counts confirmed tracks only when they cross an editable zone line;
- separates upward and downward screen motion;
- reports per-class, per-zone, and time-bucket totals; and
- exports events and summaries as CSV or JSON.

### Windows quick start

From the repository folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-and-run.ps1
```

The script installs a supported Node.js LTS release when necessary, installs the locked web dependencies, prepares the local ONNX Runtime assets, starts the development server, and opens the app.

### Manual start

```bash
cd web
npm install
npm run dev
```

Presenter materials are available in [English](PRESENTATION.md) and [Czech](PRESENTATION_CS.md). See [`web/README.md`](web/README.md) for operation, model, validation, and counting details.

## Flutter scaffold

The Flutter sources provide a future mobile shell with home, live scan, imported-video, and results flows. They also define a `VehicleInferenceService` abstraction, a mock implementation, and Android/iOS method-channel stubs for eventual native ONNX Runtime integration.

The native inference implementation is not complete and was not built in this environment because the Flutter SDK is unavailable. The browser application does not depend on it.

### Native inference contract

- Method channel: `ai_vision_traffic_scanner/inference`
- Event channel: `ai_vision_traffic_scanner/inference_stream`

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

See [`docs/yolo_mobile_integration.md`](docs/yolo_mobile_integration.md) for the proposed native training, export, and runtime pipeline.
