import { describe, expect, it } from 'vitest'
import { clampRect, intersectionOverUnion, padRect, rectUnion } from '../src/lib/geometry'
import type { RectNorm } from '../src/types'

function expectRectClose(actual: RectNorm, expected: RectNorm) {
  expect(actual.left).toBeCloseTo(expected.left, 10)
  expect(actual.top).toBeCloseTo(expected.top, 10)
  expect(actual.width).toBeCloseTo(expected.width, 10)
  expect(actual.height).toBeCloseTo(expected.height, 10)
}

describe('intersectionOverUnion', () => {
  it('reports full overlap for identical rectangles', () => {
    const rect: RectNorm = { left: 0.2, top: 0.3, width: 0.4, height: 0.5 }
    expect(intersectionOverUnion(rect, { ...rect })).toBeCloseTo(1, 10)
  })

  it('reports no overlap for disjoint rectangles', () => {
    const a: RectNorm = { left: 0, top: 0, width: 0.2, height: 0.2 }
    const b: RectNorm = { left: 0.5, top: 0.5, width: 0.2, height: 0.2 }
    expect(intersectionOverUnion(a, b)).toBe(0)
  })

  it('computes the ratio for a partial overlap', () => {
    // Two 0.2x0.2 rects offset by 0.1 horizontally overlap over 0.1x0.2.
    const a: RectNorm = { left: 0, top: 0, width: 0.2, height: 0.2 }
    const b: RectNorm = { left: 0.1, top: 0, width: 0.2, height: 0.2 }
    // intersection 0.02, union 0.04 + 0.04 - 0.02 = 0.06 -> 1/3.
    expect(intersectionOverUnion(a, b)).toBeCloseTo(1 / 3, 10)
  })
})

describe('rectUnion', () => {
  it('produces the smallest rectangle containing every input', () => {
    const a: RectNorm = { left: 0, top: 0, width: 0.2, height: 0.2 }
    const b: RectNorm = { left: 0.5, top: 0.5, width: 0.2, height: 0.2 }
    expectRectClose(rectUnion([a, b]), { left: 0, top: 0, width: 0.7, height: 0.7 })
  })

  it('falls back to the full frame for an empty input', () => {
    expectRectClose(rectUnion([]), { left: 0, top: 0, width: 1, height: 1 })
  })
})

describe('clampRect', () => {
  it('clamps an out-of-range rectangle into the unit square', () => {
    const clamped = clampRect({ left: -0.2, top: 0.5, width: 2, height: 1 })
    expectRectClose(clamped, { left: 0, top: 0.5, width: 1, height: 0.5 })
  })
})

describe('padRect', () => {
  it('clamps expansion at the frame edges', () => {
    const padded = padRect({ left: 0.05, top: 0.05, width: 0.9, height: 0.9 }, 0.1)
    expectRectClose(padded, { left: 0, top: 0, width: 1, height: 1 })
  })
})
