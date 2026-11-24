"""CSV / JSON exports, format-compatible with the previous web app."""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime

from .schema import (
    DIRECTIONS,
    VEHICLE_CLASSES,
    AnalysisConfig,
    CountEvent,
    CountingZone,
)


def summarize(events: list[CountEvent], zones: list[CountingZone]) -> dict:
    def empty_classes() -> dict[str, int]:
        return dict.fromkeys(VEHICLE_CLASSES, 0)

    def empty_directions() -> dict[str, int]:
        return dict.fromkeys(DIRECTIONS, 0)

    per_zone = {
        z.id: {
            "zoneId": z.id,
            "label": z.label,
            "lineOrientation": z.line_orientation,
            "total": 0,
            "byDirection": empty_directions(),
            "byClass": empty_classes(),
        }
        for z in zones
    }
    by_class, by_direction = empty_classes(), empty_directions()
    for e in events:
        by_class[e.vehicle_class] += 1
        by_direction[e.direction] += 1
        zone = per_zone.get(e.zone_id)
        if zone:
            zone["total"] += 1
            zone["byDirection"][e.direction] += 1
            zone["byClass"][e.vehicle_class] += 1
    return {
        "total": len(events),
        "byClass": by_class,
        "byDirection": by_direction,
        "zones": [per_zone[z.id] for z in zones],
    }


def _csv(rows: list[list[str]]) -> str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\r\n").writerows(rows)
    return buffer.getvalue()


def events_csv(events: list[CountEvent], zones: list[CountingZone]) -> str:
    labels = {z.id: z.label for z in zones}
    rows = [["video_time_s", "zone", "class", "direction", "track_id"]]
    rows += [
        [f"{e.video_time:.2f}", labels.get(e.zone_id, e.zone_id), e.vehicle_class, e.direction, str(e.track_id)]
        for e in events
    ]
    return _csv(rows)


def summary_csv(events: list[CountEvent], zones: list[CountingZone], preprocessing: str) -> str:
    counts = summarize(events, zones)
    header = ["zone", "line_orientation", "preprocessing_profile", "total", "down", "up", "left", "right"]
    rows = [header + list(VEHICLE_CLASSES)]

    def row(label: str, orientation: str, c: dict) -> list[str]:
        d = c["byDirection"]
        return [
            label, orientation, preprocessing, str(c["total"]),
            str(d["down"]), str(d["up"]), str(d["left"]), str(d["right"]),
            *(str(c["byClass"][k]) for k in VEHICLE_CLASSES),
        ]

    rows += [row(z["label"], z["lineOrientation"], z) for z in counts["zones"]]
    rows.append(row("TOTAL", "", counts))
    return _csv(rows)


def session_json(
    *,
    file_name: str,
    duration_seconds: float,
    engine: dict | None,
    config: AnalysisConfig,
    events: list[CountEvent],
    performance: dict | None = None,
) -> dict:
    return {
        "fileName": file_name,
        "durationSeconds": duration_seconds,
        "processedAt": datetime.now(UTC).isoformat(),
        "engine": engine,
        "config": config.model_dump(by_alias=True, exclude={"zones"}),
        "zones": [z.model_dump(by_alias=True) for z in config.zones],
        "counts": summarize(events, config.zones),
        "events": [e.model_dump(by_alias=True) for e in events],
        **({"performance": performance} if performance else {}),
    }
