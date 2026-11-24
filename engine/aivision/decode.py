"""Sequential video decoding with PyAV (FFmpeg).

Frames are decoded strictly in order — no seeking — which is the single
biggest speed-up over the browser version. Multithreaded software decoding
is the default; NVDEC can be enabled with AIVISION_HWDEC=1.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

import av
import numpy as np

from .schema import Rect

log = logging.getLogger(__name__)


@dataclass(slots=True)
class VideoInfo:
    path: str
    width: int
    height: int
    fps: float
    duration: float
    frame_count: int
    codec: str
    hw_decode: bool


@dataclass(slots=True)
class DecodedFrame:
    index: int
    time: float
    #: Detector input: the ROI crop resized to `size`x`size`, RGB uint8.
    model_rgb: np.ndarray
    #: Optional preview image (BGR uint8, max edge `preview_edge`).
    preview_bgr: np.ndarray | None


def _open(path: str | Path, hw: bool):
    # Measured on RTX 3070 Ti + Ryzen 5900X: multithreaded software decode of 4K H.264
    # (~370 fps) beats NVDEC + download (~210 fps), so NVDEC is opt-in.
    if hw and os.environ.get("AIVISION_HWDEC") == "1":
        try:
            from av.codec.hwaccel import HWAccel, hwdevices_available

            if "cuda" in hwdevices_available():
                return av.open(str(path), hwaccel=HWAccel("cuda", allow_software_fallback=True)), True
        except Exception as error:  # noqa: BLE001 - fall back to software
            log.info("Hardware decode unavailable: %s", error)
    return av.open(str(path)), False


def probe(path: str | Path) -> VideoInfo:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or stream.guessed_rate or 25)
        if stream.duration is not None and stream.time_base is not None:
            duration = float(stream.duration * stream.time_base)
        elif container.duration is not None:
            duration = container.duration / av.time_base
        else:
            duration = 0.0
        frames = stream.frames or round(duration * fps)
        return VideoInfo(
            path=str(path),
            width=stream.codec_context.width,
            height=stream.codec_context.height,
            fps=fps,
            duration=duration,
            frame_count=int(frames),
            codec=stream.codec_context.name,
            hw_decode=False,
        )


def iter_frames(
    path: str | Path,
    model_size: int,
    roi: Rect,
    sampling_fps: float = 0.0,
    preview_edge: int = 0,
    hw: bool = True,  # honoured only when AIVISION_HWDEC=1
    info_out: VideoInfo | None = None,
    want_preview: Callable[[], bool] | None = None,
) -> Iterator[DecodedFrame]:
    """Yields decoded, cropped and model-sized frames in presentation order.

    `sampling_fps == 0` yields every frame. Otherwise frames are picked on a
    fixed video-time grid, so results depend only on the video, not on speed.
    """
    container, hw_active = _open(path, hw)
    if info_out is not None:
        info_out.hw_decode = hw_active
    try:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        time_base = stream.time_base or Fraction(1, 1000)
        start = stream.start_time or 0

        width, height = stream.codec_context.width, stream.codec_context.height
        crop_x = round(roi.left * width)
        crop_y = round(roi.top * height)
        crop_w = max(2, round(roi.width * width))
        crop_h = max(2, round(roi.height * height))
        full_frame = crop_x == 0 and crop_y == 0 and crop_w == width and crop_h == height

        preview_size: tuple[int, int] | None = None
        if preview_edge:
            scale = min(1.0, preview_edge / max(width, height))
            preview_size = (max(2, round(width * scale) // 2 * 2), max(2, round(height * scale) // 2 * 2))

        step = 1.0 / sampling_fps if sampling_fps > 0 else 0.0
        next_time = 0.0
        index = 0
        for frame in container.decode(stream):
            pts = frame.pts if frame.pts is not None else 0
            t = float((pts - start) * time_base)
            if step:
                if t + 1e-6 < next_time:
                    continue
                next_time += step * max(1, int((t - next_time) / step) + 1)

            if full_frame:
                model_rgb = frame.to_ndarray(width=model_size, height=model_size, format="rgb24")
            else:
                rgb = frame.to_ndarray(format="rgb24")
                crop = rgb[crop_y : crop_y + crop_h, crop_x : crop_x + crop_w]
                import cv2  # local import keeps decode importable without OpenCV in tests

                model_rgb = cv2.resize(crop, (model_size, model_size), interpolation=cv2.INTER_AREA)

            preview = None
            if preview_size is not None and (want_preview is None or want_preview()):
                preview = frame.to_ndarray(width=preview_size[0], height=preview_size[1], format="bgr24")

            yield DecodedFrame(index=index, time=t, model_rgb=model_rgb, preview_bgr=preview)
            index += 1
    finally:
        container.close()
