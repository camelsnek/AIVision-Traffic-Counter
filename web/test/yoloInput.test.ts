import { describe, expect, it } from 'vitest'

import { fillYoloInput } from '../src/lib/yoloInput'

describe('fillYoloInput', () => {
  it('writes RGB bytes as top-left-padded NCHW floats and ignores alpha', () => {
    const f = (byte: number) => Math.fround(byte / 255)
    const rgba = new Uint8ClampedArray([
      255, 128, 0, 1,
      0, 64, 255, 254,
      32, 16, 8, 0,
      4, 2, 1, 255,
    ])
    const output = new Float32Array(3 * 3 * 3)

    fillYoloInput(rgba, 2, 2, output, 3)

    expect(Array.from(output)).toEqual([
      1, 0, 0,
      f(32), f(4), 0,
      0, 0, 0,
      f(128), f(64), 0,
      f(16), f(2), 0,
      0, 0, 0,
      0, 1, 0,
      f(8), f(1), 0,
      0, 0, 0,
    ])
  })

  it('clears stale values when reusing the output buffer for a smaller crop', () => {
    const output = new Float32Array(3 * 2 * 2)
    fillYoloInput(new Uint8Array(2 * 2 * 4).fill(255), 2, 2, output, 2)
    fillYoloInput(new Uint8Array([255, 0, 0, 255]), 1, 1, output, 2)

    expect(Array.from(output)).toEqual([
      1, 0,
      0, 0,
      0, 0,
      0, 0,
      0, 0,
      0, 0,
    ])
  })

  it('rejects malformed dimensions and buffers', () => {
    expect(() => fillYoloInput(new Uint8Array(4), 0, 1, new Float32Array(12), 2)).toThrow(
      'positive integers',
    )
    expect(() => fillYoloInput(new Uint8Array(4), 3, 1, new Float32Array(12), 2)).toThrow(
      'exceeds',
    )
    expect(() => fillYoloInput(new Uint8Array(3), 1, 1, new Float32Array(12), 2)).toThrow(
      'length',
    )
  })
})
