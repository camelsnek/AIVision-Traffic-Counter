"""RF-DETR vehicle detector on ONNX Runtime.

Provider selection, best first: TensorRT (FP16, cached engine) → CUDA →
DirectML → CPU. "auto" walks that list and keeps the first one that
actually initialises and runs a warm-up inference.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .models import ensure_model, get_profile, models_dir
from .schema import Detection, DevicePreference, EngineInfo, Rect, VehicleClass

log = logging.getLogger(__name__)

# COCO category ids used by the RF-DETR checkpoints (91-way logits).
COCO_VEHICLES: dict[int, VehicleClass] = {3: "car", 4: "motorcycle", 6: "bus", 8: "truck"}
_VEHICLE_IDS = np.array(sorted(COCO_VEHICLES), dtype=np.int64)
_VEHICLE_NAMES: list[VehicleClass] = [COCO_VEHICLES[i] for i in _VEHICLE_IDS]

_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

#: Same-class boxes above this IoU are duplicates of one object.
SAME_CLASS_IOU = 0.6
#: Any-class boxes above this IoU are one object detected as two classes.
CROSS_CLASS_IOU = 0.82


@dataclass(slots=True)
class DetectorTimings:
    preprocess_ms: float
    inference_ms: float
    postprocess_ms: float


def _import_ort():
    try:
        import onnxruntime as ort
    except ImportError as error:  # pragma: no cover - environment problem
        raise RuntimeError(
            "ONNX Runtime is not installed. Install the engine with one of the extras: "
            "[cuda], [directml] or [cpu]."
        ) from error
    preload = getattr(ort, "preload_dlls", None)
    if preload is not None:
        try:
            preload()  # loads pip-installed CUDA/cuDNN DLLs on Windows
        except Exception as error:  # noqa: BLE001 - optional best effort
            log.debug("preload_dlls failed: %s", error)
    return ort


def _provider_candidates(preference: DevicePreference, available: list[str]) -> list[tuple[str, dict]]:
    cache_dir = models_dir() / "trt-cache"
    trt_options = {
        "trt_fp16_enable": True,
        "trt_engine_cache_enable": True,
        "trt_engine_cache_path": str(cache_dir),
        "trt_timing_cache_enable": True,
        "trt_timing_cache_path": str(cache_dir),
        "trt_builder_optimization_level": 3,
    }
    gpu: list[tuple[str, dict]] = []
    if os.environ.get("AIVISION_DISABLE_TENSORRT") != "1":
        gpu.append(("TensorrtExecutionProvider", trt_options))
    gpu += [
        ("CUDAExecutionProvider", {"cudnn_conv_algo_search": "HEURISTIC"}),
        ("DmlExecutionProvider", {}),
    ]
    cpu = [("CPUExecutionProvider", {})]
    wanted = cpu if preference == "cpu" else gpu if preference == "gpu" else gpu + cpu
    return [(name, opts) for name, opts in wanted if name in available]


_PROVIDER_LABELS = {
    "TensorrtExecutionProvider": "TensorRT",
    "CUDAExecutionProvider": "CUDA",
    "DmlExecutionProvider": "DirectML",
    "CPUExecutionProvider": "CPU",
}


class VehicleDetector:
    """Loads one RF-DETR ONNX model and detects vehicles in RGB frames."""

    def __init__(self, model_id: str, device: DevicePreference = "auto") -> None:
        self.profile = get_profile(model_id)
        self.input_size = self.profile.input_size
        model_file = ensure_model(model_id)
        ort = _import_ort()
        available = ort.get_available_providers()
        candidates = _provider_candidates(device, available)
        if not candidates:
            raise RuntimeError(
                f"No ONNX Runtime provider satisfies device='{device}'. Available: {', '.join(available)}"
            )

        errors: list[str] = []
        for name, options in candidates:
            try:
                session = self._create_session(ort, model_file, name, options)
            except Exception as error:  # noqa: BLE001 - try the next provider
                log.warning("Provider %s failed: %s", name, error)
                errors.append(f"{_PROVIDER_LABELS.get(name, name)}: {error}")
                continue
            self.session = session
            self.provider = name
            break
        else:
            raise RuntimeError("Could not initialise any inference provider. " + " | ".join(errors))

        self.input_name = self.session.get_inputs()[0].name
        outputs = [o.name for o in self.session.get_outputs()]
        self._boxes_name = "pred_boxes" if "pred_boxes" in outputs else outputs[0]
        self._logits_name = "logits" if "logits" in outputs else outputs[1]
        precision = "fp16" if name == "TensorrtExecutionProvider" else "fp32"
        self.info = EngineInfo(
            model_id=self.profile.id,
            provider=_PROVIDER_LABELS.get(self.provider, self.provider),
            precision=precision,
            input_size=self.input_size,
            extra={"fallbacks": "; ".join(errors)} if errors else {},
        )
        log.info("Detector ready: %s on %s (%s)", self.profile.label, self.info.provider, precision)

    def _create_session(self, ort, model_file: Path, name: str, options: dict):
        if name == "TensorrtExecutionProvider":
            Path(options["trt_engine_cache_path"]).mkdir(parents=True, exist_ok=True)
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.log_severity_level = 3
        if name == "DmlExecutionProvider":
            opts.enable_mem_pattern = False
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session = ort.InferenceSession(str(model_file), sess_options=opts, providers=[(name, options)])
        if name not in session.get_providers():
            raise RuntimeError(f"{name} was not enabled by ONNX Runtime")
        # Warm-up also triggers the (one-off, cached) TensorRT engine build.
        dummy = np.zeros((1, 3, self.input_size, self.input_size), dtype=np.float32)
        session.run(None, {session.get_inputs()[0].name: dummy})
        return session

    # ------------------------------------------------------------------ inference

    def preprocess(self, rgb: np.ndarray) -> np.ndarray:
        """HxWx3 uint8 RGB (any size) → 1x3xSxS normalized float32 tensor."""
        size = self.input_size
        if rgb.shape[0] != size or rgb.shape[1] != size:
            rgb = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_LINEAR)
        x = rgb.astype(np.float32) * (1.0 / 255.0)
        x -= _MEAN
        x /= _STD
        return np.ascontiguousarray(x.transpose(2, 0, 1)[None])

    def infer(self, tensor: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        boxes, logits = self.session.run(
            [self._boxes_name, self._logits_name], {self.input_name: tensor}
        )
        return boxes[0], logits[0]

    def postprocess(
        self, boxes: np.ndarray, logits: np.ndarray, roi: Rect, min_confidence: float
    ) -> list[Detection]:
        """Converts raw (cx, cy, w, h) boxes in ROI space to full-frame detections."""
        vehicle_logits = logits[:, _VEHICLE_IDS]
        scores = 1.0 / (1.0 + np.exp(-vehicle_logits))
        best = scores.argmax(axis=1)
        confidence = scores[np.arange(len(best)), best]
        keep = np.flatnonzero(confidence >= min_confidence)
        if keep.size == 0:
            return []

        cx, cy, w, h = boxes[keep].T
        x1 = np.clip(cx - w / 2, 0, 1) * roi.width + roi.left
        y1 = np.clip(cy - h / 2, 0, 1) * roi.height + roi.top
        x2 = np.clip(cx + w / 2, 0, 1) * roi.width + roi.left
        y2 = np.clip(cy + h / 2, 0, 1) * roi.height + roi.top

        detections = [
            Detection(
                vehicle_class=_VEHICLE_NAMES[int(best[i])],
                confidence=float(confidence[i]),
                x1=float(x1[k]),
                y1=float(y1[k]),
                x2=float(x2[k]),
                y2=float(y2[k]),
            )
            for k, i in enumerate(keep)
            if x2[k] > x1[k] and y2[k] > y1[k]
        ]
        return suppress_duplicates(detections)

    def detect(self, rgb: np.ndarray, roi: Rect, min_confidence: float) -> tuple[list[Detection], DetectorTimings]:
        t0 = time.perf_counter()
        tensor = self.preprocess(rgb)
        t1 = time.perf_counter()
        boxes, logits = self.infer(tensor)
        t2 = time.perf_counter()
        detections = self.postprocess(boxes, logits, roi, min_confidence)
        t3 = time.perf_counter()
        return detections, DetectorTimings((t1 - t0) * 1e3, (t2 - t1) * 1e3, (t3 - t2) * 1e3)


def _iou(a: Detection, b: Detection) -> float:
    left, top = max(a.x1, b.x1), max(a.y1, b.y1)
    right, bottom = min(a.x2, b.x2), min(a.y2, b.y2)
    if right <= left or bottom <= top:
        return 0.0
    inter = (right - left) * (bottom - top)
    union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
    return inter / union if union > 0 else 0.0


def suppress_duplicates(detections: list[Detection]) -> list[Detection]:
    """DETR is NMS-free, but the occasional double box (or class split) still appears."""
    kept: list[Detection] = []
    for candidate in sorted(detections, key=lambda d: d.confidence, reverse=True):
        duplicate = any(
            _iou(existing, candidate)
            >= (SAME_CLASS_IOU if existing.vehicle_class == candidate.vehicle_class else CROSS_CLASS_IOU)
            for existing in kept
        )
        if not duplicate:
            kept.append(candidate)
    return kept
