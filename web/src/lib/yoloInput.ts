export const YOLO_INPUT_EDGE = 640

const CHANNEL_COUNT = 3
const RGBA_CHANNEL_COUNT = 4
const BYTE_TO_FLOAT = 1 / 255

/**
 * Converts an RGBA crop into YOLO's top-left-padded NCHW float tensor.
 *
 * The detector already scales every crop so its longest edge is 640 pixels;
 * this function performs the remaining RGB selection, rescaling, layout, and
 * padding directly into a reusable buffer without intermediate image tensors.
 */
export function fillYoloInput(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  output: Float32Array,
  inputEdge = YOLO_INPUT_EDGE,
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('YOLO input dimensions must be positive integers.')
  }
  if (width > inputEdge || height > inputEdge) {
    throw new Error(`YOLO crop ${width}x${height} exceeds the ${inputEdge}px model input.`)
  }
  if (rgba.length !== width * height * RGBA_CHANNEL_COUNT) {
    throw new Error('YOLO RGBA input length does not match its dimensions.')
  }
  const channelArea = inputEdge * inputEdge
  if (output.length !== channelArea * CHANNEL_COUNT) {
    throw new Error('YOLO output buffer has the wrong length.')
  }

  output.fill(0)
  for (let y = 0; y < height; y += 1) {
    let sourceOffset = y * width * RGBA_CHANNEL_COUNT
    let targetOffset = y * inputEdge
    const rowEnd = targetOffset + width
    for (; targetOffset < rowEnd; targetOffset += 1) {
      output[targetOffset] = rgba[sourceOffset] * BYTE_TO_FLOAT
      output[channelArea + targetOffset] = rgba[sourceOffset + 1] * BYTE_TO_FLOAT
      output[channelArea * 2 + targetOffset] = rgba[sourceOffset + 2] * BYTE_TO_FLOAT
      sourceOffset += RGBA_CHANNEL_COUNT
    }
  }
}
