# RoadScope Web

React + Vite frontend for uploading a local road video and scanning vehicles in the browser.

## Features

- Local video upload
- Browser-side analysis loop
- Detection overlay canvas
- Vehicle tracking and one-count-per-vehicle session totals
- Local YOLOv10n model integration through Transformers.js

## Run locally

```bash
npm install
npm run dev
```

## Model files

The repo already includes a downloaded local model at:

- `public/models/onnx-community/yolov10n/config.json`
- `public/models/onnx-community/yolov10n/preprocessor_config.json`
- `public/models/onnx-community/yolov10n/onnx/model.onnx`

This model supports basic COCO vehicle classes used by the app: `car`, `truck`, `bus`, and `motorcycle`.
