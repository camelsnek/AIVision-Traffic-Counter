# AIVision traffic counter

Counts vehicles in recorded traffic video. You draw counting lines over the
video, and AIVision reports how many cars, trucks, buses and motorcycles
crossed each line, in which direction and when.

Everything runs on your own machine. Videos are never uploaded anywhere.

## How it works

```
 video file ──► decode (FFmpeg) ──► RF-DETR detector ──► ByteTrack ──► line crossing counter
                  every frame        on the GPU           tracker        per zone / direction
                                                                                │
                      React UI in the browser ◄── live frames + counts (WebSocket)
```

- **Engine** (`engine/`, Python): decodes the video in order, detects vehicles
  with [RF-DETR](https://github.com/roboflow/rf-detr) (Apache-2.0) through ONNX
  Runtime, tracks them with ByteTrack and counts line crossings. It also serves
  the UI and the API.
- **UI** (`web/`, React): upload videos, draw zones, watch the live analysis,
  export results.

Hardware is picked automatically: TensorRT or CUDA on NVIDIA GPUs, DirectML on
other Windows GPUs, otherwise the CPU.

### Speed

Measured on the 21-second 4K sample (538 frames), analysing every frame:

| Machine | Model | Speed |
| --- | --- | --- |
| RTX 3070 Ti + Ryzen 9 5900X, TensorRT | RF-DETR Small | ≈ 65 frames/s (3× real time) |
| RTX 3070 Ti + Ryzen 9 5900X, CUDA | RF-DETR Small | ≈ 57 frames/s |
| Laptop CPU only | RF-DETR Small | ≈ 3 frames/s |

The previous browser version reached about 14-32 analysed frames per second on
the same desktop, and only by skipping frames.

## Windows quick start

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-and-run.ps1
```

The first run installs everything into `engine\.venv` (1-3 GB download), builds
the UI, downloads the model and opens http://localhost:8000. Later runs start in
a few seconds. On an NVIDIA GPU the very first analysis takes 1-3 extra minutes
while TensorRT optimises the model; the result is cached.

Requirements: Windows 10/11 and, to rebuild the UI, Node.js LTS
(`winget install OpenJS.NodeJS.LTS`). Python is installed automatically.

## Using it

1. Drop a video on the page (MP4, MOV, MKV, AVI, TS). It is kept in the video
   library for re-runs.
2. Click **Edit zones**. Drag a zone to move it, drag its corner to resize it
   and drag the amber line to where vehicles should be counted. Choose a
   horizontal or vertical line per zone.
3. Click **Start counting**. Boxes appear once a vehicle has been tracked for a
   few frames; a tick marks vehicles that have been counted. Dashed boxes are
   vehicles the detector briefly lost and the tracker is predicting.
4. Download the results under **Export**: one row per vehicle, totals per zone,
   or a full JSON session.

### Settings

| Setting | Recommendation |
| --- | --- |
| Detection model | **Small** for most footage; **Medium** for wide scenes with distant vehicles; **Nano** for CPU-only machines. |
| Frames to analyse | **Every frame** whenever a GPU is available. Skipping frames makes fast vehicles jump between samples and is the main cause of missed counts. |
| Detection confidence | 40 % default. Lower it for distant or night traffic, raise it if parked or reflected vehicles are counted. |

## Command line

```powershell
cd engine
.\.venv\Scripts\aivision info                       # hardware and models
.\.venv\Scripts\aivision count video.mp4 --zones zones.json --out results
.\.venv\Scripts\aivision bench video.mp4 --models rfdetr-small rfdetr-medium
.\.venv\Scripts\aivision serve --port 8000 --open
```

`zones.json` is either a list of zones or a session JSON exported from the UI.

## Development (Linux or Windows)

```bash
cd engine && uv sync --extra cpu        # or --extra cuda / --extra directml
uv run aivision serve --port 8000       # API + built UI

cd web && npm install && npm run dev    # UI with hot reload on :5173, proxied to :8000
npm test && npm run lint && npm run build
```

Environment variables:

| Variable | Effect |
| --- | --- |
| `AIVISION_DATA_DIR` | Where uploaded videos are stored (default `engine/data`). |
| `AIVISION_MODELS_DIR` | Where models and the TensorRT cache live (default `engine/models`). |
| `AIVISION_DISABLE_TENSORRT=1` | Use CUDA directly. |
| `AIVISION_TRT_FP16=1` | TensorRT FP16. About 40 % faster, but on RF-DETR it currently loses many detections, so it is off by default. |
| `AIVISION_HWDEC=1` | NVDEC hardware decoding. Slower than CPU decoding on a fast desktop CPU, useful on weak CPUs. |

The roadmap toward a validated measurement tool (benchmark footage, review
workflow, Czech vehicle categories) is in
[docs/PRODUCTION_ROADMAP.md](docs/PRODUCTION_ROADMAP.md).
