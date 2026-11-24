from __future__ import annotations

from collections.abc import Iterable

from .schema import Rect

FULL_FRAME = Rect(left=0, top=0, width=1, height=1)


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def rect_union(rects: Iterable[Rect]) -> Rect:
    rects = list(rects)
    if not rects:
        return FULL_FRAME
    left = min(r.left for r in rects)
    top = min(r.top for r in rects)
    right = max(r.right for r in rects)
    bottom = max(r.bottom for r in rects)
    return Rect(left=left, top=top, width=right - left, height=bottom - top)


def pad_rect(rect: Rect, padding: float) -> Rect:
    left = clamp(rect.left - padding, 0, 1)
    top = clamp(rect.top - padding, 0, 1)
    right = clamp(rect.right + padding, 0, 1)
    bottom = clamp(rect.bottom + padding, 0, 1)
    return Rect(left=left, top=top, width=right - left, height=bottom - top)


def region_of_interest(regions: Iterable[Rect], padding: float = 0.04, full_frame_coverage: float = 0.82) -> Rect:
    """Padded union of zone regions, or the full frame when that union covers most of it."""
    padded = pad_rect(rect_union(regions), padding)
    if padded.width * padded.height >= full_frame_coverage:
        return FULL_FRAME
    return padded
