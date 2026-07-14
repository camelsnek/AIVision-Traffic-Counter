import type { PreprocessingProfileId } from '../types'

const HISTOGRAM_BINS = 256
const NIGHT_TILE_COLUMNS = 8
const NIGHT_TILE_ROWS = 8
const NIGHT_CLIP_LIMIT = 2

export interface PreprocessingProfile {
  id: PreprocessingProfileId
  label: string
  description: string
  parameters: Readonly<Record<string, number | string>>
}

export const preprocessingProfiles: readonly PreprocessingProfile[] = [
  {
    id: 'standard-v1',
    label: 'Standard',
    description: 'Uses the resized video frame without changing its pixels.',
    parameters: { transform: 'none' },
  },
  {
    id: 'night-clahe-v1',
    label: 'Night',
    description: 'Enhances local luminance contrast for dark road footage while retaining color information.',
    parameters: {
      transform: 'luminance-clahe',
      tileColumns: NIGHT_TILE_COLUMNS,
      tileRows: NIGHT_TILE_ROWS,
      clipLimit: NIGHT_CLIP_LIMIT,
    },
  },
]

export function getPreprocessingProfile(profileId: PreprocessingProfileId): PreprocessingProfile {
  return preprocessingProfiles.find((profile) => profile.id === profileId) ?? preprocessingProfiles[0]
}

/**
 * Applies the selected detector-input transform to an RGBA frame.
 * Standard mode returns the original allocation; transformed modes return a new buffer.
 */
export function preprocessRgba(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  profileId: PreprocessingProfileId,
): Uint8Array | Uint8ClampedArray {
  assertRgbaFrame(data, width, height)
  if (profileId === 'standard-v1') {
    return data
  }

  return applyLuminanceClahe(data, width, height, {
    tileColumns: NIGHT_TILE_COLUMNS,
    tileRows: NIGHT_TILE_ROWS,
    clipLimit: NIGHT_CLIP_LIMIT,
  })
}

interface ClaheOptions {
  tileColumns: number
  tileRows: number
  clipLimit: number
}

function applyLuminanceClahe(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: ClaheOptions,
): Uint8ClampedArray {
  const pixelCount = width * height
  const luminance = new Uint8Array(pixelCount)
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
    // Integer Rec. 601 luma. The coefficients sum to 256, so adding the
    // mapped luma delta back to RGB retains chroma until a channel clips.
    luminance[pixel] = (77 * rgba[offset] + 150 * rgba[offset + 1] + 29 * rgba[offset + 2] + 128) >> 8
  }

  const tileColumns = Math.min(options.tileColumns, width)
  const tileRows = Math.min(options.tileRows, height)
  const lookupTables = buildClaheLookupTables(luminance, width, height, tileColumns, tileRows, options.clipLimit)
  const output = new Uint8ClampedArray(rgba.length)

  for (let y = 0; y < height; y += 1) {
    const tileY = ((y + 0.5) * tileRows) / height - 0.5
    const rawTop = Math.floor(tileY)
    const bottomWeight = tileY - rawTop
    const top = clampIndex(rawTop, tileRows)
    const bottom = clampIndex(rawTop + 1, tileRows)

    for (let x = 0; x < width; x += 1) {
      const tileX = ((x + 0.5) * tileColumns) / width - 0.5
      const rawLeft = Math.floor(tileX)
      const rightWeight = tileX - rawLeft
      const left = clampIndex(rawLeft, tileColumns)
      const right = clampIndex(rawLeft + 1, tileColumns)
      const pixel = y * width + x
      const inputLuma = luminance[pixel]

      const mappedTop = lerp(
        lookupTables[(top * tileColumns + left) * HISTOGRAM_BINS + inputLuma],
        lookupTables[(top * tileColumns + right) * HISTOGRAM_BINS + inputLuma],
        rightWeight,
      )
      const mappedBottom = lerp(
        lookupTables[(bottom * tileColumns + left) * HISTOGRAM_BINS + inputLuma],
        lookupTables[(bottom * tileColumns + right) * HISTOGRAM_BINS + inputLuma],
        rightWeight,
      )
      const lumaDelta = Math.round(lerp(mappedTop, mappedBottom, bottomWeight)) - inputLuma
      const offset = pixel * 4

      output[offset] = rgba[offset] + lumaDelta
      output[offset + 1] = rgba[offset + 1] + lumaDelta
      output[offset + 2] = rgba[offset + 2] + lumaDelta
      output[offset + 3] = rgba[offset + 3]
    }
  }

  return output
}

function buildClaheLookupTables(
  luminance: Uint8Array,
  width: number,
  height: number,
  tileColumns: number,
  tileRows: number,
  clipLimit: number,
): Uint8Array {
  const lookupTables = new Uint8Array(tileColumns * tileRows * HISTOGRAM_BINS)

  for (let tileRow = 0; tileRow < tileRows; tileRow += 1) {
    const top = Math.floor((tileRow * height) / tileRows)
    const bottom = Math.floor(((tileRow + 1) * height) / tileRows)

    for (let tileColumn = 0; tileColumn < tileColumns; tileColumn += 1) {
      const left = Math.floor((tileColumn * width) / tileColumns)
      const right = Math.floor(((tileColumn + 1) * width) / tileColumns)
      const histogram = new Uint32Array(HISTOGRAM_BINS)

      for (let y = top; y < bottom; y += 1) {
        const rowOffset = y * width
        for (let x = left; x < right; x += 1) {
          histogram[luminance[rowOffset + x]] += 1
        }
      }

      const tileArea = (right - left) * (bottom - top)
      clipHistogram(histogram, Math.max(1, Math.floor((clipLimit * tileArea) / HISTOGRAM_BINS)))

      const tableOffset = (tileRow * tileColumns + tileColumn) * HISTOGRAM_BINS
      let cumulative = 0
      const scale = 255 / tileArea
      for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
        cumulative += histogram[bin]
        lookupTables[tableOffset + bin] = Math.round(cumulative * scale)
      }
    }
  }

  return lookupTables
}

function clipHistogram(histogram: Uint32Array, limit: number) {
  let clipped = 0
  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    if (histogram[bin] > limit) {
      clipped += histogram[bin] - limit
      histogram[bin] = limit
    }
  }

  const shared = Math.floor(clipped / HISTOGRAM_BINS)
  if (shared > 0) {
    for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
      histogram[bin] += shared
    }
  }

  const remainder = clipped - shared * HISTOGRAM_BINS
  if (remainder === 0) {
    return
  }

  const step = HISTOGRAM_BINS / remainder
  for (let index = 0; index < remainder; index += 1) {
    histogram[Math.floor(index * step)] += 1
  }
}

function assertRgbaFrame(data: Uint8Array | Uint8ClampedArray, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Frame dimensions must be positive integers.')
  }
  if (data.length !== width * height * 4) {
    throw new Error(`Expected ${width * height * 4} RGBA bytes, received ${data.length}.`)
  }
}

function clampIndex(index: number, length: number) {
  return Math.min(length - 1, Math.max(0, index))
}

function lerp(left: number, right: number, weight: number) {
  return left + (right - left) * weight
}
