"""Shared data contracts.

Field names serialize as camelCase so the JSON matches the React app's
TypeScript types (`web/src/types.ts`) one-to-one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

VehicleClass = Literal["car", "truck", "bus", "motorcycle"]
VEHICLE_CLASSES: tuple[VehicleClass, ...] = ("car", "truck", "bus", "motorcycle")

Direction = Literal["down", "up", "right", "left"]
DIRECTIONS: tuple[Direction, ...] = ("down", "up", "right", "left")

LineOrientation = Literal["horizontal", "vertical"]
PreprocessingProfileId = Literal["standard-v1", "night-clahe-v1"]
DevicePreference = Literal["auto", "gpu", "cpu"]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class Rect(ApiModel):
    """Axis-aligned rectangle normalized to [0, 1] frame space."""

    left: float
    top: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.left + self.width

    @property
    def bottom(self) -> float:
        return self.top + self.height


class CountingZone(ApiModel):
    id: str
    label: str
    region: Rect
    line_orientation: LineOrientation = "horizontal"
    #: Line position across the region: top-to-bottom (horizontal) or left-to-right (vertical).
    line_offset: float = Field(0.55, ge=0.0, le=1.0)


class AnalysisConfig(ApiModel):
    model_id: str = "rfdetr-small"
    device: DevicePreference = "auto"
    preprocessing_profile_id: PreprocessingProfileId = "standard-v1"
    confidence: float = Field(0.35, ge=0.05, le=0.95)
    #: Analysed frames per second of video time; 0 analyses every decoded frame.
    sampling_fps: float = Field(0.0, ge=0.0, le=240.0)
    zones: list[CountingZone] = Field(min_length=1)


class CountEvent(ApiModel):
    seq: int
    track_id: int
    zone_id: str
    vehicle_class: VehicleClass
    direction: Direction
    video_time: float


class Point(ApiModel):
    x: float
    y: float


class TrackSnapshot(ApiModel):
    id: int
    vehicle_class: VehicleClass
    confidence: float
    box: Rect
    hits: int
    confirmed: bool
    coasting: bool
    trail: list[Point]
    counted_zones: list[str]


@dataclass(slots=True)
class Detection:
    """A single-frame detector output in normalized full-frame coordinates (xyxy)."""

    vehicle_class: VehicleClass
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)


@dataclass(slots=True)
class EngineInfo:
    model_id: str
    provider: str
    precision: str
    input_size: int
    extra: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "modelId": self.model_id,
            "provider": self.provider,
            "precision": self.precision,
            "inputSize": self.input_size,
            **self.extra,
        }
