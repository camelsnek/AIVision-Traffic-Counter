import { describe, expect, it } from 'vitest'

import { getPreprocessingProfile, preprocessRgba } from '../src/lib/framePreprocessing'

function rgbaFrame(width: number, height: number, pixel: (x: number, y: number) => readonly number[]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const [red, green, blue, alpha = 255] = pixel(x, y)
      data[offset] = red
      data[offset + 1] = green
      data[offset + 2] = blue
      data[offset + 3] = alpha
    }
  }
  return data
}

function channelRange(data: Uint8Array | Uint8ClampedArray, channel: number) {
  let minimum = 255
  let maximum = 0
  for (let offset = channel; offset < data.length; offset += 4) {
    minimum = Math.min(minimum, data[offset])
    maximum = Math.max(maximum, data[offset])
  }
  return maximum - minimum
}

describe('frame preprocessing', () => {
  it('leaves the standard profile byte-for-byte untouched without allocating', () => {
    const input = rgbaFrame(3, 2, (x, y) => [x * 40, y * 70, 25, 100 + x + y])

    const output = preprocessRgba(input, 3, 2, 'standard-v1')

    expect(output).toBe(input)
    expect([...output]).toEqual([...input])
  })

  it('enhances local separation in a dark frame while preserving alpha', () => {
    const input = rgbaFrame(64, 64, (x, y) => {
      const value = (x + y) % 2 === 0 ? 20 : 30
      return [value, value, value, (x * 7 + y * 3) % 256]
    })

    const output = preprocessRgba(input, 64, 64, 'night-clahe-v1')

    expect(output).not.toBe(input)
    expect(channelRange(output, 0)).toBeGreaterThan(channelRange(input, 0))
    for (let offset = 3; offset < output.length; offset += 4) {
      expect(output[offset]).toBe(input[offset])
    }
  })

  it('retains neutral colors and RGB channel differences away from clipping', () => {
    const neutral = rgbaFrame(32, 32, (x, y) => {
      const value = 70 + ((x * 3 + y * 5) % 50)
      return [value, value, value, 255]
    })
    const colored = rgbaFrame(32, 32, (x, y) => {
      const base = 80 + ((x * 3 + y * 5) % 30)
      return [base, base + 10, base + 20, 255]
    })

    const neutralOutput = preprocessRgba(neutral, 32, 32, 'night-clahe-v1')
    const coloredOutput = preprocessRgba(colored, 32, 32, 'night-clahe-v1')

    let unclippedColors = 0
    for (let offset = 0; offset < neutralOutput.length; offset += 4) {
      expect(neutralOutput[offset]).toBe(neutralOutput[offset + 1])
      expect(neutralOutput[offset + 1]).toBe(neutralOutput[offset + 2])
      if (coloredOutput[offset] > 0 && coloredOutput[offset + 2] < 255) {
        expect(coloredOutput[offset + 1] - coloredOutput[offset]).toBe(10)
        expect(coloredOutput[offset + 2] - coloredOutput[offset + 1]).toBe(10)
        unclippedColors += 1
      }
    }
    expect(unclippedColors).toBeGreaterThan(0)
  })

  it('is deterministic for dimensions that are not divisible by the tile grid', () => {
    const input = rgbaFrame(53, 37, (x, y) => [(x * 11 + y) % 180, (x + y * 7) % 190, (x * 3 + y * 5) % 200, 255])

    const first = preprocessRgba(input, 53, 37, 'night-clahe-v1')
    const second = preprocessRgba(input, 53, 37, 'night-clahe-v1')

    expect([...first]).toEqual([...second])
  })

  it('rejects malformed frame buffers', () => {
    expect(() => preprocessRgba(new Uint8ClampedArray(15), 2, 2, 'night-clahe-v1')).toThrow(
      'Expected 16 RGBA bytes',
    )
    expect(() => preprocessRgba(new Uint8ClampedArray(0), 0, 1, 'night-clahe-v1')).toThrow(
      'Frame dimensions must be positive integers',
    )
  })

  it('exposes the exact versioned night parameters', () => {
    expect(getPreprocessingProfile('night-clahe-v1')).toMatchObject({
      label: 'Night',
      parameters: {
        transform: 'luminance-clahe',
        tileColumns: 8,
        tileRows: 8,
        clipLimit: 2,
      },
    })
  })
})
