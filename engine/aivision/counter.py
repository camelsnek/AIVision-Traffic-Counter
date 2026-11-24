"""Line-crossing counter on top of ByteTrack.

Semantics are ported from the web app's `trafficCounter.ts`:
* a vehicle is counted only when the center of a track crosses a zone's
  line while inside the line's bounded extent;
* each track is counted at most once per zone;
* crossings made while a track is still tentative are remembered and only
  emitted once the track is confirmed, so detector flicker never counts.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .schema import CountEvent, CountingZone, Direction, Point, Rect, TrackSnapshot
from .tracker import ByteTracker, Track

MAX_TRAIL_POINTS = 32


@dataclass(slots=True)
class _PendingCrossing:
    zone_id: str
    direction: Direction
    video_time: float


@dataclass(slots=True)
class _TrackState:
    last_center: tuple[float, float]
    trail: list[tuple[float, float]] = field(default_factory=list)
    counted_zones: set[str] = field(default_factory=set)
    pending: list[_PendingCrossing] = field(default_factory=list)


def crossing_direction(
    zone: CountingZone, previous: tuple[float, float], current: tuple[float, float]
) -> Direction | None:
    (px, py), (cx, cy) = previous, current
    region = zone.region
    if zone.line_orientation == "vertical":
        line_x = region.left + region.width * zone.line_offset
        if px < line_x <= cx:
            direction: Direction = "right"
        elif px > line_x >= cx:
            direction = "left"
        else:
            return None
        progress = (line_x - px) / (cx - px)
        crossing_y = py + (cy - py) * progress
        return direction if region.top <= crossing_y <= region.bottom else None

    line_y = region.top + region.height * zone.line_offset
    if py < line_y <= cy:
        direction = "down"
    elif py > line_y >= cy:
        direction = "up"
    else:
        return None
    progress = (line_y - py) / (cy - py)
    crossing_x = px + (cx - px) * progress
    return direction if region.left <= crossing_x <= region.right else None


class TrafficCounter:
    def __init__(self, zones: list[CountingZone], tracker: ByteTracker | None = None) -> None:
        self.zones = list(zones)
        self.tracker = tracker or ByteTracker()
        self._states: dict[int, _TrackState] = {}
        self._next_seq = 1

    def update(self, detections, video_time: float) -> tuple[list[TrackSnapshot], list[CountEvent]]:
        matched, live = self.tracker.update(detections)
        events: list[CountEvent] = []

        for track in matched:
            state = self._states.get(track.id)
            center = track.center
            if state is None:
                self._states[track.id] = _TrackState(last_center=center, trail=[center])
                continue
            previous = state.last_center
            state.last_center = center
            state.trail.append(center)
            del state.trail[:-MAX_TRAIL_POINTS]
            self._detect_crossings(track, state, previous, center, video_time, events)

        # Newly confirmed tracks flush crossings recorded while tentative.
        for track in live:
            state = self._states.get(track.id)
            if state and track.confirmed and state.pending:
                for pending in state.pending:
                    events.append(self._emit(track, pending.zone_id, pending.direction, pending.video_time))
                state.pending.clear()

        live_ids = {t.id for t in live}
        for track_id in [i for i in self._states if i not in live_ids]:
            del self._states[track_id]

        events.sort(key=lambda e: e.seq)
        return [self._snapshot(t) for t in live], events

    def _detect_crossings(
        self,
        track: Track,
        state: _TrackState,
        previous: tuple[float, float],
        current: tuple[float, float],
        video_time: float,
        events: list[CountEvent],
    ) -> None:
        for zone in self.zones:
            if zone.id in state.counted_zones:
                continue
            direction = crossing_direction(zone, previous, current)
            if direction is None:
                continue
            state.counted_zones.add(zone.id)
            if track.confirmed:
                events.append(self._emit(track, zone.id, direction, video_time))
            else:
                state.pending.append(_PendingCrossing(zone.id, direction, video_time))

    def _emit(self, track: Track, zone_id: str, direction: Direction, video_time: float) -> CountEvent:
        event = CountEvent(
            seq=self._next_seq,
            track_id=track.id,
            zone_id=zone_id,
            vehicle_class=track.vehicle_class,
            direction=direction,
            video_time=round(video_time, 3),
        )
        self._next_seq += 1
        return event

    def _snapshot(self, track: Track) -> TrackSnapshot:
        x1, y1, x2, y2 = (float(v) for v in track.box)
        state = self._states.get(track.id)
        trail = state.trail if state else [track.center]
        return TrackSnapshot(
            id=track.id,
            vehicle_class=track.vehicle_class,
            confidence=round(track.detection.confidence, 3),
            box=Rect(left=x1, top=y1, width=max(0.0, x2 - x1), height=max(0.0, y2 - y1)),
            hits=track.hits,
            confirmed=track.confirmed,
            coasting=track.misses > 0,
            trail=[Point(x=x, y=y) for x, y in trail],
            counted_zones=sorted(state.counted_zones - {p.zone_id for p in state.pending}) if state else [],
        )
