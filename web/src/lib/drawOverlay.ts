import type { TrackedVehicle } from '../types'

export function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  tracks: TrackedVehicle[],
  countingLinePosition: number,
) {
  const width = video.videoWidth || video.clientWidth
  const height = video.videoHeight || video.clientHeight
  if (!width || !height) {
    return
  }

  if (canvas.width !== width) {
    canvas.width = width
  }
  if (canvas.height !== height) {
    canvas.height = height
  }

  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  context.clearRect(0, 0, width, height)

  context.strokeStyle = '#ff7b54'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(0, height * countingLinePosition)
  context.lineTo(width, height * countingLinePosition)
  context.stroke()

  context.font = '600 12px "Segoe UI", sans-serif'

  for (const track of tracks) {
    const left = track.boundingBox.left * width
    const top = track.boundingBox.top * height
    const boxWidth = track.boundingBox.width * width
    const boxHeight = track.boundingBox.height * height

    context.strokeStyle = colorForClass(track.vehicleClass)
    context.lineWidth = 2
    context.strokeRect(left, top, boxWidth, boxHeight)

    if (track.counted) {
      const label = track.vehicleClass.toUpperCase()
      const labelWidth = context.measureText(label).width + 12
      const labelTop = Math.max(0, top - 22)

      context.fillStyle = 'rgba(6, 14, 20, 0.78)'
      context.fillRect(left, labelTop, labelWidth, 18)

      context.fillStyle = '#f7f8f4'
      context.fillText(label, left + 6, labelTop + 13)
    }
  }
}

function colorForClass(vehicleClass: TrackedVehicle['vehicleClass']) {
  switch (vehicleClass) {
    case 'car':
      return '#2a9d8f'
    case 'truck':
      return '#e63946'
    case 'bus':
      return '#6d597a'
    case 'motorcycle':
      return '#1d3557'
  }
}
