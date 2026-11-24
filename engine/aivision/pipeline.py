"""Threaded decode → detect → track/count pipeline.

Three stages run concurrently, connected by small bounded queues:

    decoder thread ──► preprocess+infer (main loop) ──► tracker/counter
         (CPU / NVDEC)        (GPU)                          (CPU)

Decoding and tensor preparation for frame N+1 overlap GPU inference for
frame N. Tracking and counting always commit strictly in frame order.
"""

from __future__ import annotations

import contextlib
import queue
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from .counter import TrafficCounter
from .decode import DecodedFrame, VideoInfo, iter_frames, probe
from .detector import VehicleDetector
from .geometry import region_of_interest
from .schema import AnalysisConfig, CountEvent, Rect, TrackSnapshot
from .tracker import ByteTracker

_SENTINEL = object()
#: Weakest detections kept for ByteTrack's second (track-extension) pass.
LOW_CONFIDENCE = 0.15


@dataclass(slots=True)
class FrameTimings:
    decode_ms: float
    preprocess_ms: float
    inference_ms: float
    postprocess_ms: float
    tracking_ms: float

    def to_json(self) -> dict:
        return {
            "decodeMs": round(self.decode_ms, 2),
            "preprocessMs": round(self.preprocess_ms, 2),
            "inferenceMs": round(self.inference_ms, 2),
            "postprocessMs": round(self.postprocess_ms, 2),
            "trackingMs": round(self.tracking_ms, 2),
        }


@dataclass(slots=True)
class FrameResult:
    index: int
    video_time: float
    progress: float
    tracks: list[TrackSnapshot]
    events: list[CountEvent]
    timings: FrameTimings
    throughput_fps: float
    preview_bgr: np.ndarray | None


@dataclass
class RunSummary:
    video: VideoInfo
    frames: int
    wall_seconds: float
    events: list[CountEvent] = field(default_factory=list)
    stopped: bool = False

    @property
    def fps(self) -> float:
        return self.frames / self.wall_seconds if self.wall_seconds > 0 else 0.0


class _Throughput:
    def __init__(self, window: int = 30) -> None:
        self._stamps: deque[float] = deque(maxlen=window)

    def tick(self) -> float:
        now = time.perf_counter()
        self._stamps.append(now)
        if len(self._stamps) < 2:
            return 0.0
        return (len(self._stamps) - 1) / (self._stamps[-1] - self._stamps[0])


class Pipeline:
    def __init__(self, detector: VehicleDetector, config: AnalysisConfig) -> None:
        self.detector = detector
        self.config = config
        self.roi: Rect = region_of_interest(zone.region for zone in config.zones)
        self._stop = threading.Event()
        self._resume = threading.Event()
        self._resume.set()

    # ------------------------------------------------------------- controls

    def stop(self) -> None:
        self._stop.set()
        self._resume.set()

    def pause(self) -> None:
        self._resume.clear()

    def resume(self) -> None:
        self._resume.set()

    @property
    def paused(self) -> bool:
        return not self._resume.is_set()

    # ------------------------------------------------------------------ run

    def run(
        self,
        video_path: str,
        on_frame: Callable[[FrameResult], None] | None = None,
        preview_edge: int = 0,
        preview_interval_s: float = 0.0,
    ) -> RunSummary:
        info = probe(video_path)
        counter = TrafficCounter(self.config.zones, make_tracker(self.config.confidence))
        frames_q: queue.Queue = queue.Queue(maxsize=8)
        decode_error: list[BaseException] = []

        next_preview_at = [0.0]

        def want_preview() -> bool:
            """Wall-clock throttle: preview images are costly, the UI needs ~10-15/s."""
            now = time.perf_counter()
            if now >= next_preview_at[0]:
                next_preview_at[0] = now + preview_interval_s
                return True
            return False

        def decoder() -> None:
            try:
                last = time.perf_counter()
                for frame in iter_frames(
                    video_path,
                    model_size=self.detector.input_size,
                    roi=self.roi,
                    sampling_fps=self.config.sampling_fps,
                    preview_edge=preview_edge,
                    info_out=info,
                    want_preview=want_preview,
                ):
                    if self._stop.is_set():
                        break
                    # Tensor prep runs here so it overlaps GPU inference on the main loop.
                    p0 = time.perf_counter()
                    tensor = self.detector.preprocess(frame.model_rgb)
                    prep_ms = (time.perf_counter() - p0) * 1e3
                    frames_q.put((frame, tensor, (p0 - last) * 1e3, prep_ms))
                    last = time.perf_counter()
            except BaseException as error:  # noqa: BLE001 - surfaced to caller
                decode_error.append(error)
            finally:
                frames_q.put(_SENTINEL)

        thread = threading.Thread(target=decoder, name="aivision-decoder", daemon=True)
        started = time.perf_counter()
        thread.start()

        throughput = _Throughput()
        events: list[CountEvent] = []
        frames = 0
        duration = info.duration or 1.0
        try:
            while True:
                self._resume.wait()
                if self._stop.is_set():
                    break
                item = frames_q.get()
                if item is _SENTINEL:
                    break
                frame: DecodedFrame = item[0]
                tensor = item[1]
                decode_ms: float = item[2]
                prep_ms: float = item[3]

                t1 = time.perf_counter()
                boxes, logits = self.detector.infer(tensor)
                t2 = time.perf_counter()
                # Low threshold on purpose: ByteTrack's second pass uses weak boxes.
                detections = self.detector.postprocess(
                    boxes, logits, self.roi, min(self.config.confidence, LOW_CONFIDENCE)
                )
                t3 = time.perf_counter()
                tracks, new_events = counter.update(detections, frame.time)
                t4 = time.perf_counter()

                events.extend(new_events)
                frames += 1
                if on_frame is not None:
                    send_preview = frame.preview_bgr is not None
                    on_frame(
                        FrameResult(
                            index=frame.index,
                            video_time=frame.time,
                            progress=min(1.0, frame.time / duration),
                            tracks=tracks,
                            events=new_events,
                            timings=FrameTimings(
                                decode_ms,
                                prep_ms,
                                (t2 - t1) * 1e3,
                                (t3 - t2) * 1e3,
                                (t4 - t3) * 1e3,
                            ),
                            throughput_fps=throughput.tick(),
                            preview_bgr=frame.preview_bgr if send_preview else None,
                        )
                    )
        finally:
            stopped_by_user = self._stop.is_set()
            self._stop.set()
            # Drain so the decoder thread can observe the stop flag and exit.
            while thread.is_alive():
                with contextlib.suppress(queue.Empty):
                    frames_q.get(timeout=0.05)
            thread.join(timeout=2)

        if decode_error:
            raise RuntimeError(f"Video decoding failed: {decode_error[0]}") from decode_error[0]

        return RunSummary(
            video=info,
            frames=frames,
            wall_seconds=time.perf_counter() - started,
            events=events,
            stopped=stopped_by_user,
        )


def make_tracker(confidence: float) -> ByteTracker:
    """ByteTrack thresholds derived from the user's confidence setting.

    Boxes at or above `confidence` are 'high' and may start tracks; weaker
    boxes down to LOW_CONFIDENCE only extend existing tracks.
    """
    return ByteTracker(
        high_threshold=confidence,
        new_track_threshold=min(0.95, confidence + 0.05),
        low_threshold=min(LOW_CONFIDENCE, confidence),
    )
