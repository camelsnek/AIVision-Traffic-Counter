"""ByteTrack multi-object tracker (self-contained, numpy + scipy).

Why ByteTrack instead of the old greedy matcher:
* a constant-velocity Kalman filter predicts where each vehicle moves, so
  tracks survive occlusions and short detection drop-outs;
* low-confidence detections are used in a second association pass to keep
  existing tracks alive (they never start new tracks), which is what stops
  a partially hidden car from being split into two tracks and counted twice;
* matching is globally optimal (Hungarian) rather than greedy.

Reference: Zhang et al., "ByteTrack: Multi-Object Tracking by Associating
Every Detection Box", ECCV 2022.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from .schema import VEHICLE_CLASSES, Detection, VehicleClass

# --------------------------------------------------------------------- Kalman


class KalmanBox:
    """Constant-velocity Kalman filter over (cx, cy, aspect, height)."""

    _F = np.eye(8)
    _F[:4, 4:] = np.eye(4)
    _H = np.eye(4, 8)
    _STD_POS = 1.0 / 20
    _STD_VEL = 1.0 / 160

    def __init__(self, measurement: np.ndarray) -> None:
        self.mean = np.r_[measurement, np.zeros(4)]
        h = measurement[3]
        std = [
            2 * self._STD_POS * h, 2 * self._STD_POS * h, 1e-2, 2 * self._STD_POS * h,
            10 * self._STD_VEL * h, 10 * self._STD_VEL * h, 1e-5, 10 * self._STD_VEL * h,
        ]
        self.cov = np.diag(np.square(std))

    def predict(self) -> None:
        h = self.mean[3]
        q = np.diag(np.square([
            self._STD_POS * h, self._STD_POS * h, 1e-2, self._STD_POS * h,
            self._STD_VEL * h, self._STD_VEL * h, 1e-5, self._STD_VEL * h,
        ]))
        self.mean = self._F @ self.mean
        self.cov = self._F @ self.cov @ self._F.T + q

    def update(self, measurement: np.ndarray) -> None:
        h = self.mean[3]
        r = np.diag(np.square([self._STD_POS * h, self._STD_POS * h, 1e-1, self._STD_POS * h]))
        s = self._H @ self.cov @ self._H.T + r
        gain = np.linalg.solve(s, (self.cov @ self._H.T).T).T
        self.mean = self.mean + gain @ (measurement - self._H @ self.mean)
        self.cov = self.cov - gain @ s @ gain.T

    @property
    def xyxy(self) -> np.ndarray:
        cx, cy, a, h = self.mean[:4]
        w = a * h
        return np.array([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2])

    @property
    def velocity(self) -> tuple[float, float]:
        return float(self.mean[4]), float(self.mean[5])


def _xyah(d: Detection) -> np.ndarray:
    w, h = d.x2 - d.x1, d.y2 - d.y1
    return np.array([(d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2, w / max(h, 1e-6), h])


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise IoU between two (N, 4) and (M, 4) xyxy arrays."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    lt = np.maximum(a[:, None, :2], b[None, :, :2])
    rb = np.minimum(a[:, None, 2:], b[None, :, 2:])
    wh = np.clip(rb - lt, 0, None)
    inter = wh[..., 0] * wh[..., 1]
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(area_a[:, None] + area_b[None, :] - inter, 1e-12)


# ---------------------------------------------------------------------- track


@dataclass(eq=False)
class Track:
    id: int
    kalman: KalmanBox
    detection: Detection
    hits: int = 1
    #: Consecutive analysed frames without a matched detection.
    misses: int = 0
    confirmed: bool = False
    class_scores: dict[VehicleClass, float] = field(default_factory=lambda: dict.fromkeys(VEHICLE_CLASSES, 0.0))

    def __post_init__(self) -> None:
        self.class_scores[self.detection.vehicle_class] += self.detection.confidence

    @property
    def box(self) -> np.ndarray:
        """Latest box: the matched detection, or the Kalman prediction while coasting."""
        if self.misses == 0:
            d = self.detection
            return np.array([d.x1, d.y1, d.x2, d.y2])
        return self.kalman.xyxy

    @property
    def center(self) -> tuple[float, float]:
        """Center of the latest real observation (used for line crossing)."""
        return self.detection.center

    @property
    def vehicle_class(self) -> VehicleClass:
        return max(self.class_scores, key=self.class_scores.__getitem__)


# -------------------------------------------------------------------- tracker


class ByteTracker:
    def __init__(
        self,
        high_threshold: float = 0.5,
        low_threshold: float = 0.15,
        new_track_threshold: float = 0.55,
        match_iou: float = 0.2,
        low_match_iou: float = 0.5,
        min_hits: int = 3,
        max_misses: int = 30,
    ) -> None:
        self.high_threshold = high_threshold
        self.low_threshold = low_threshold
        self.new_track_threshold = new_track_threshold
        self.match_iou = match_iou
        self.low_match_iou = low_match_iou
        self.min_hits = min_hits
        self.max_misses = max_misses
        self.tracks: list[Track] = []
        self._next_id = 1

    def update(self, detections: list[Detection]) -> tuple[list[Track], list[Track]]:
        """Advances one analysed frame.

        Returns (matched tracks that received a detection this frame, all live tracks).
        """
        for track in self.tracks:
            track.kalman.predict()

        high = [d for d in detections if d.confidence >= self.high_threshold]
        low = [d for d in detections if self.low_threshold <= d.confidence < self.high_threshold]

        # 1st pass: confirmed + tentative tracks against high-confidence detections.
        matched: list[Track] = []
        unmatched_tracks, unmatched_high = self._associate(self.tracks, high, self.match_iou, matched)

        # 2nd pass: remaining tracks that were recently seen, against low-confidence boxes.
        recent = [t for t in unmatched_tracks if t.misses == 0 or t.confirmed]
        stale = [t for t in unmatched_tracks if t not in recent]
        still_unmatched, _ = self._associate(recent, low, self.low_match_iou, matched)

        for track in still_unmatched + stale:
            track.misses += 1

        # Unmatched tentative tracks die immediately; confirmed ones coast.
        self.tracks = [
            t for t in self.tracks
            if (t.misses == 0) or (t.confirmed and t.misses <= self.max_misses)
        ]

        for det in unmatched_high:
            if det.confidence >= self.new_track_threshold:
                self.tracks.append(Track(self._next_id, KalmanBox(_xyah(det)), det))
                self._next_id += 1

        for track in self.tracks:
            if not track.confirmed and track.hits >= self.min_hits:
                track.confirmed = True

        return matched, self.tracks

    def _associate(
        self,
        tracks: list[Track],
        detections: list[Detection],
        min_iou: float,
        matched: list[Track],
    ) -> tuple[list[Track], list[Detection]]:
        if not tracks or not detections:
            return list(tracks), list(detections)

        predicted = np.array([t.kalman.xyxy for t in tracks])
        boxes = np.array([[d.x1, d.y1, d.x2, d.y2] for d in detections])
        iou = iou_matrix(predicted, boxes)
        # Prefer same-class matches slightly; DETR occasionally flips car/truck.
        cost = 1.0 - iou
        rows, cols = linear_sum_assignment(cost)

        used_tracks: set[int] = set()
        used_dets: set[int] = set()
        for r, c in zip(rows, cols, strict=True):
            if iou[r, c] < min_iou:
                continue
            track, det = tracks[r], detections[c]
            track.kalman.update(_xyah(det))
            track.detection = det
            track.hits += 1
            track.misses = 0
            track.class_scores[det.vehicle_class] += det.confidence
            matched.append(track)
            used_tracks.add(r)
            used_dets.add(c)

        return (
            [t for i, t in enumerate(tracks) if i not in used_tracks],
            [d for i, d in enumerate(detections) if i not in used_dets],
        )
