import type { PointNorm, RectNorm } from '../types'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function clamp01(value: number) {
  return clamp(value, 0, 1)
}

export function rectCenter(rect: RectNorm): PointNorm {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function centerDistance(a: RectNorm, b: RectNorm) {
  const ca = rectCenter(a)
  const cb = rectCenter(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y)
}

export function intersectionOverUnion(a: RectNorm, b: RectNorm) {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)

  if (right <= left || bottom <= top) {
    return 0
  }

  const intersection = (right - left) * (bottom - top)
  const union = a.width * a.height + b.width * b.height - intersection
  return union > 0 ? intersection / union : 0
}

/** Smallest rectangle containing every input rectangle. */
export function rectUnion(rects: readonly RectNorm[]): RectNorm {
  if (rects.length === 0) {
    return { left: 0, top: 0, width: 1, height: 1 }
  }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const rect of rects) {
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.left + rect.width)
    bottom = Math.max(bottom, rect.top + rect.height)
  }

  return { left, top, width: right - left, height: bottom - top }
}

/** Expands a rect by `padding` on every side, clamped to the unit square. */
export function padRect(rect: RectNorm, padding: number): RectNorm {
  const left = clamp01(rect.left - padding)
  const top = clamp01(rect.top - padding)
  const right = clamp01(rect.left + rect.width + padding)
  const bottom = clamp01(rect.top + rect.height + padding)
  return { left, top, width: right - left, height: bottom - top }
}

/** Clamps a rect so it stays inside the unit square with non-negative size. */
export function clampRect(rect: RectNorm): RectNorm {
  const left = clamp01(rect.left)
  const top = clamp01(rect.top)
  return {
    left,
    top,
    width: clamp(rect.width, 0, 1 - left),
    height: clamp(rect.height, 0, 1 - top),
  }
}
