# AIVision Traffic Counter — Web

The production-ready browser application in this repository. It analyzes a local road video entirely on-device, detects vehicles with YOLOv10, tracks them across deterministic video-time samples, and counts a vehicle only when its track crosses a configured counting line.

No video is uploaded to a server.

## What it does

- Runs local YOLOv10-N or YOLOv10-M ONNX models through Transformers.js.
- Lets the user select Auto, GPU/WebGPU, or CPU/WebAssembly inference.
- Samples uploaded videos by video timestamp, so results do not depend on playback speed or machine performance.
- Tracks tentative and confirmed vehicles through brief detection gaps.
- Counts crossings in all four screen directions exactly once per vehicle and zone.
- Supports editable rectangular zones with independently positioned horizontal or vertical counting lines.
- Reports totals by class, direction, zone, and five-second flow bucket.
- Exports event-level CSV, summary CSV, and full JSON results.
- Keeps model weights and ONNX Runtime assets local; runtime CDN access is not required.

Supported COCO vehicle classes are `car`, `truck`, `bus`, and `motorcycle`.

## Run locally

Requirements: a current Node.js release and a modern browser.

```bash
npm install
npm run dev
```

`predev` copies the ONNX Runtime assets matching the installed Transformers.js version into `vendor/ort/`. Open the printed local URL, choose a road video, adjust zones if needed, and select **Start analysis**.

## Counting-line orientation

Select **Edit zones**, choose a zone, and use **Horizontal** or **Vertical** under **Counting line**. The highlighted grip moves top-to-bottom for a horizontal line and left-to-right for a vertical line. Horizontal lines report downward/upward crossings; vertical lines report leftward/rightward crossings. A session may mix both orientations across independent zones.

Summary CSV and JSON exports preserve each zone's orientation and all four direction totals.

## Performance controls

- **Auto — prefer GPU** is the default. It uses WebGPU when a high-performance adapter is available and falls back to CPU/WASM if GPU session creation fails.
- **GPU — WebGPU** requires a current browser and working hardware acceleration. The option is marked unavailable when the browser cannot obtain an adapter. An explicit GPU choice never silently runs on the CPU.
- **CPU — WebAssembly** uses the quantized model in the most compatible single-threaded runtime. It is reliable but normally slower.
- **YOLOv10-N** is the performance-oriented model; YOLOv10-M is substantially heavier.
- **Sampling rate** controls how many video timestamps are analyzed. Reducing it from 10 to 5 fps roughly halves the number of inference calls and usually the total analysis time. It does not make an individual model call faster.

The live `fps` metric is analyzed frames per wall-clock second and includes video seeking, frame preparation, inference, tracking, and rendering. `ms/frame` measures detector work only. Large or highly compressed 4K videos can therefore show lower overall fps even when GPU inference itself is fast.

## Validation

```bash
npm test
npm run lint
npm run build
```

The test suite covers geometry, event aggregation, exports, and the tracking/counting contracts: horizontal and vertical bidirectional crossings, mixed-orientation zones, one count per track, stationary-object rejection, detection gaps, parallel vehicles, tentative tracks, class voting, and zone bounds.

## Counting model

Each analysis run uses fixed video-time sampling. Detections are associated with predicted tracks using overlap, center distance, and class history. A track must receive multiple detections before it is confirmed. Crossing events are emitted only when two real observations place the vehicle center on opposite sides of a zone's line; persistent or disappearing objects are not counted merely for existing.

The confidence control trades recall against false positives. The default `0.35` is a practical starting point for ordinary oblique road footage. Very small, distant, motion-blurred, or top-down vehicles may require a different threshold or a model trained for that camera perspective.

## Local model files

Models are loaded from `public/models/`:

- `onnx-community/yolov10n` — fast default; includes FP32 and quantized weights.
- `onnx-community/yolov10m` — heavier model for more capable machines.

These are COCO models. Camera placement and domain fit remain the largest determinants of detection accuracy.
