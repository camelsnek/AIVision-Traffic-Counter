"""FastAPI backend: video library, analysis runs, live WebSocket feed, exports.

One analysis runs at a time (one GPU). The run executes in a worker thread;
the WebSocket pushes a coalesced state stream at ~15 Hz plus JPEG preview
frames paired with the track overlay computed on that exact frame.

REST
  GET    /api/info                       runtime, providers, model profiles
  GET    /api/videos                     uploaded video library
  POST   /api/videos                     upload (multipart "file")
  GET    /api/videos/{id}/poster.jpg     still frame for zone editing
  DELETE /api/videos/{id}
  POST   /api/runs                       {videoId, config} → start analysis
  POST   /api/runs/current/{pause|resume|stop}
  GET    /api/runs/current/export/{events.csv|summary.csv|session.json}
WebSocket
  /api/ws                                JSON state messages + binary JPEG previews
"""

from __future__ import annotations

import asyncio
import contextlib
import gc
import json
import logging
import os
import re
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import cv2
from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from .decode import VideoInfo, probe
from .detector import VehicleDetector
from .export import events_csv, session_json, summary_csv
from .models import MODEL_PROFILES, model_path
from .pipeline import FrameResult, Pipeline
from .schema import AnalysisConfig, ApiModel, CountEvent

log = logging.getLogger(__name__)

PREVIEW_EDGE = 1280
PREVIEW_FPS = 12
PREVIEW_JPEG_QUALITY = 78
WS_INTERVAL_S = 1 / 15
VIDEO_ID = re.compile(r"^[a-f0-9]{12}$")
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".ts", ".mts", ".wmv", ".flv"}

RunStatus = Literal["loading", "running", "paused", "complete", "stopped", "error"]


def data_dir() -> Path:
    root = os.environ.get("AIVISION_DATA_DIR")
    path = Path(root) if root else Path(__file__).resolve().parent.parent / "data"
    (path / "videos").mkdir(parents=True, exist_ok=True)
    return path


def web_dist_dir() -> Path | None:
    root = os.environ.get("AIVISION_WEB_DIST")
    path = Path(root) if root else Path(__file__).resolve().parent.parent.parent / "web" / "dist"
    return path if (path / "index.html").exists() else None


# --------------------------------------------------------------------- videos


def _video_json(video_id: str, file: Path, info: VideoInfo) -> dict:
    return {
        "id": video_id,
        "name": file.name,
        "sizeBytes": file.stat().st_size,
        "width": info.width,
        "height": info.height,
        "fps": round(info.fps, 3),
        "durationSeconds": round(info.duration, 3),
        "frameCount": info.frame_count,
        "codec": info.codec,
    }


class VideoLibrary:
    def __init__(self, root: Path) -> None:
        self.root = root / "videos"

    def folder(self, video_id: str) -> Path:
        if not VIDEO_ID.match(video_id):
            raise HTTPException(404, "Unknown video")
        folder = self.root / video_id
        if not folder.is_dir():
            raise HTTPException(404, "Unknown video")
        return folder

    def file(self, video_id: str) -> Path:
        folder = self.folder(video_id)
        files = [p for p in folder.iterdir() if p.suffix.lower() in VIDEO_EXTENSIONS]
        if not files:
            raise HTTPException(404, "Video file missing")
        return files[0]

    def meta(self, video_id: str) -> dict:
        folder = self.folder(video_id)
        meta_file = folder / "meta.json"
        if meta_file.exists():
            try:
                return json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                meta_file.unlink(missing_ok=True)  # corrupt cache: re-probe below
        file = self.file(video_id)
        meta = _video_json(video_id, file, probe(file))
        meta_file.write_text(json.dumps(meta), encoding="utf-8")
        return meta

    def list(self) -> list[dict]:
        items = []
        for folder in sorted(self.root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if folder.is_dir() and VIDEO_ID.match(folder.name):
                with contextlib.suppress(HTTPException, OSError, ValueError):
                    items.append(self.meta(folder.name))
        return items

    async def save_upload(self, upload: UploadFile) -> dict:
        name = Path(upload.filename or "video.mp4").name
        suffix = Path(name).suffix.lower()
        if suffix not in VIDEO_EXTENSIONS:
            raise HTTPException(415, f"Unsupported file type '{suffix}'.")
        safe_name = re.sub(r"[^\w.\- ]+", "_", name)[:120] or f"video{suffix}"
        video_id = uuid.uuid4().hex[:12]
        folder = self.root / video_id
        folder.mkdir(parents=True)
        target = folder / safe_name
        try:
            with target.open("wb") as out:
                while chunk := await upload.read(8 << 20):
                    out.write(chunk)
            info = await asyncio.to_thread(probe, target)
            if info.width <= 0 or info.height <= 0:
                raise ValueError("no decodable video stream")
            await asyncio.to_thread(_write_poster, target, folder / "poster.jpg", info)
            meta = _video_json(video_id, target, info)
            (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        except HTTPException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        except Exception as error:
            shutil.rmtree(folder, ignore_errors=True)
            raise HTTPException(422, f"Could not read this video: {error}") from error
        return meta

    def delete(self, video_id: str) -> None:
        """Removes a video folder. Unknown ids raise HTTP 404 (via `folder`)."""
        folder = self.folder(video_id)
        try:
            shutil.rmtree(folder)
        except OSError as error:
            raise HTTPException(500, f"Could not delete video: {error}") from error


def _write_poster(video: Path, target: Path, info: VideoInfo) -> None:
    import av

    wanted = min(1.0, info.duration / 2) if info.duration else 0.0
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        time_base = float(stream.time_base or 0) or 1 / 1000
        start = stream.start_time or 0
        chosen = None
        for frame in container.decode(stream):
            chosen = frame
            if frame.pts is not None and (frame.pts - start) * time_base >= wanted:
                break
        if chosen is None:
            raise ValueError("video has no frames")
        scale = min(1.0, PREVIEW_EDGE / max(info.width, info.height))
        image = chosen.to_ndarray(
            width=max(2, round(info.width * scale)), height=max(2, round(info.height * scale)), format="bgr24"
        )
    ok, data = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise ValueError("poster encoding failed")
    target.write_bytes(data.tobytes())


# ----------------------------------------------------------------------- runs


@dataclass
class Preview:
    seq: int
    video_time: float
    tracks: list[dict]
    jpeg: bytes


@dataclass
class RunState:
    id: str
    video: dict
    config: AnalysisConfig
    status: RunStatus = "loading"
    error: str | None = None
    engine: dict | None = None
    events: list[CountEvent] = field(default_factory=list)
    progress: float = 0.0
    video_time: float = 0.0
    timings: dict = field(default_factory=dict)
    throughput_fps: float = 0.0
    frames: int = 0
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    performance: dict | None = None
    preview: Preview | None = None
    version: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def touch(self) -> None:
        self.version += 1

    def header(self) -> dict:
        return {
            "type": "run",
            "runId": self.id,
            "video": self.video,
            "config": self.config.model_dump(by_alias=True),
        }

    def status_message(self, events_from: int) -> dict:
        return {
            "type": "status",
            "runId": self.id,
            "status": self.status,
            "error": self.error,
            "engine": self.engine,
            "progress": round(self.progress, 4),
            "videoTime": round(self.video_time, 3),
            "durationSeconds": self.video.get("durationSeconds", 0),
            "timings": self.timings,
            "throughputFps": round(self.throughput_fps, 1),
            "frames": self.frames,
            "performance": self.performance,
            "eventsFrom": events_from,
            "events": [e.model_dump(by_alias=True) for e in self.events[events_from:]],
        }


class RunManager:
    def __init__(self, library: VideoLibrary) -> None:
        self.library = library
        self.current: RunState | None = None
        self._pipeline: Pipeline | None = None
        self._detector: VehicleDetector | None = None
        self._detector_key: tuple[str, str] | None = None
        self._lock = threading.Lock()

    @property
    def busy(self) -> bool:
        state = self.current
        return state is not None and state.status in ("loading", "running", "paused")

    def start(self, video_id: str, config: AnalysisConfig) -> RunState:
        with self._lock:
            if self.busy:
                raise HTTPException(409, "An analysis is already running.")
            video = self.library.meta(video_id)
            path = self.library.file(video_id)
            state = RunState(id=uuid.uuid4().hex[:12], video=video, config=config)
            self.current = state
            threading.Thread(target=self._run, args=(state, path), name="aivision-run", daemon=True).start()
            return state

    def _get_detector(self, config: AnalysisConfig) -> VehicleDetector:
        key = (config.model_id, config.device)
        if self._detector is not None and self._detector_key == key:
            return self._detector
        # Release the previous session before loading another (8 GB VRAM budget).
        self._detector = None
        self._detector_key = None
        gc.collect()
        detector = VehicleDetector(config.model_id, config.device)
        self._detector, self._detector_key = detector, key
        return detector

    def _run(self, state: RunState, path: Path) -> None:
        try:
            detector = self._get_detector(state.config)
            with state.lock:
                state.engine = detector.info.to_json()
                state.status = "running"
                state.touch()
            pipeline = Pipeline(detector, state.config)
            self._pipeline = pipeline
            preview_seq = [0]
            inference: list[float] = []

            def on_frame(result: FrameResult) -> None:
                inference.append(result.timings.inference_ms)
                preview = None
                if result.preview_bgr is not None:
                    ok, data = cv2.imencode(
                        ".jpg", result.preview_bgr, [cv2.IMWRITE_JPEG_QUALITY, PREVIEW_JPEG_QUALITY]
                    )
                    if ok:
                        preview_seq[0] += 1
                        preview = Preview(
                            seq=preview_seq[0],
                            video_time=result.video_time,
                            tracks=[t.model_dump(by_alias=True) for t in result.tracks],
                            jpeg=data.tobytes(),
                        )
                with state.lock:
                    state.events.extend(result.events)
                    state.progress = result.progress
                    state.video_time = result.video_time
                    state.timings = result.timings.to_json()
                    state.throughput_fps = result.throughput_fps
                    state.frames += 1
                    if preview is not None:
                        state.preview = preview
                    state.touch()

            summary = pipeline.run(
                str(path),
                on_frame=on_frame,
                preview_edge=PREVIEW_EDGE,
                preview_interval_s=1 / PREVIEW_FPS,
            )
            inference.sort()
            with state.lock:
                state.status = "stopped" if summary.stopped else "complete"
                if not summary.stopped:
                    state.progress = 1.0
                state.performance = {
                    "frames": summary.frames,
                    "wallSeconds": round(summary.wall_seconds, 2),
                    "fps": round(summary.fps, 1),
                    "medianInferenceMs": round(inference[len(inference) // 2], 2) if inference else 0,
                    "realtimeFactor": round(summary.video.duration / summary.wall_seconds, 2)
                    if summary.wall_seconds
                    else 0,
                    "hwDecode": summary.video.hw_decode,
                }
                state.finished_at = time.time()
                state.touch()
        except Exception as error:
            log.exception("Analysis failed")
            with state.lock:
                state.status = "error"
                state.error = str(error) or error.__class__.__name__
                state.finished_at = time.time()
                state.touch()
        finally:
            self._pipeline = None

    def control(self, action: str) -> RunState:
        state = self.current
        pipeline = self._pipeline
        if state is None:
            raise HTTPException(404, "No analysis has been started.")
        with state.lock:
            if action == "pause" and state.status == "running" and pipeline:
                pipeline.pause()
                state.status = "paused"
            elif action == "resume" and state.status == "paused" and pipeline:
                pipeline.resume()
                state.status = "running"
            elif action == "stop" and pipeline:
                pipeline.stop()
            state.touch()
        return state


# ------------------------------------------------------------------------ app


class StartRequest(ApiModel):
    video_id: str
    config: AnalysisConfig


def create_app() -> FastAPI:
    library = VideoLibrary(data_dir())
    runs = RunManager(library)
    app = FastAPI(title="AIVision", version=__version__)
    app.state.runs = runs

    @app.get("/api/info")
    def info() -> dict:
        providers: list[str] = []
        with contextlib.suppress(ImportError):
            import onnxruntime as ort

            if hasattr(ort, "preload_dlls"):
                with contextlib.suppress(Exception):
                    ort.preload_dlls()
            providers = ort.get_available_providers()
        return {
            "version": __version__,
            "providers": providers,
            "gpu": any(p in providers for p in ("TensorrtExecutionProvider", "CUDAExecutionProvider",
                                                "DmlExecutionProvider")),
            "models": [
                {
                    "id": p.id,
                    "label": p.label,
                    "description": p.description,
                    "inputSize": p.input_size,
                    "downloaded": model_path(p).exists(),
                }
                for p in MODEL_PROFILES.values()
            ],
        }

    @app.get("/api/videos")
    def list_videos() -> list[dict]:
        return library.list()

    @app.post("/api/videos")
    async def upload_video(file: UploadFile) -> dict:
        return await library.save_upload(file)

    @app.get("/api/videos/{video_id}/poster.jpg")
    def poster(video_id: str) -> FileResponse:
        path = library.folder(video_id) / "poster.jpg"
        if not path.exists():
            raise HTTPException(404, "No poster")
        return FileResponse(path, media_type="image/jpeg")

    @app.delete("/api/videos/{video_id}")
    def delete_video(video_id: str) -> dict:
        state = runs.current
        if runs.busy and state is not None and state.video["id"] == video_id:
            raise HTTPException(409, "This video is being analysed.")
        library.delete(video_id)
        return {"ok": True}

    @app.post("/api/runs")
    def start_run(request: StartRequest) -> dict:
        state = runs.start(request.video_id, request.config)
        return {"runId": state.id}

    @app.post("/api/runs/current/{action}")
    def control_run(action: Literal["pause", "resume", "stop"]) -> dict:
        state = runs.control(action)
        return {"runId": state.id, "status": state.status}

    @app.get("/api/runs/current/export/{kind}")
    def export(kind: Literal["events.csv", "summary.csv", "session.json"]) -> Response:
        state = runs.current
        if state is None:
            raise HTTPException(404, "No analysis to export.")
        with state.lock:
            events = list(state.events)
        zones = state.config.zones
        stem = Path(state.video["name"]).stem
        headers = {"Content-Disposition": f'attachment; filename="{stem}-{kind}"'}
        if kind == "events.csv":
            return Response(events_csv(events, zones), media_type="text/csv", headers=headers)
        if kind == "summary.csv":
            body = summary_csv(events, zones, state.config.preprocessing_profile_id)
            return Response(body, media_type="text/csv", headers=headers)
        body = session_json(
            file_name=state.video["name"],
            duration_seconds=state.video.get("durationSeconds", 0),
            engine=state.engine,
            config=state.config,
            events=events,
            performance=state.performance,
        )
        return JSONResponse(body, headers=headers)

    @app.websocket("/api/ws")
    async def live(socket: WebSocket) -> None:
        await socket.accept()
        run_id: str | None = None
        sent_version = -1
        sent_events = 0
        sent_preview = 0
        try:
            await socket.send_json({"type": "hello", "busy": runs.busy})
            while True:
                state = runs.current
                if state is not None:
                    if state.id != run_id:
                        run_id, sent_version, sent_events, sent_preview = state.id, -1, 0, 0
                        await socket.send_json(state.header())
                    if state.version != sent_version:
                        with state.lock:
                            sent_version = state.version
                            message = state.status_message(sent_events)
                            preview = state.preview
                        sent_events += len(message["events"])
                        await socket.send_json(message)
                        if preview is not None and preview.seq != sent_preview:
                            sent_preview = preview.seq
                            await socket.send_json({
                                "type": "frame",
                                "runId": state.id,
                                "seq": preview.seq,
                                "videoTime": round(preview.video_time, 3),
                                "tracks": preview.tracks,
                            })
                            await socket.send_bytes(preview.jpeg)
                await asyncio.sleep(WS_INTERVAL_S)
        except (WebSocketDisconnect, RuntimeError):
            return

    dist = web_dist_dir()
    if dist is not None:
        app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
    else:

        @app.get("/")
        def no_ui() -> dict:
            return {"message": "AIVision API is running. Build the UI with `npm run build` in web/."}

    return app
