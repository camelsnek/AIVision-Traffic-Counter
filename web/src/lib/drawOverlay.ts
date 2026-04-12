import type { DetectionZone, TrackedVehicle } from '../types'

export function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  tracks: TrackedVehicle[],
  zones: DetectionZone[],
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

  context.font = '600 12px "Segoe UI", sans-serif'

  for (const zone of zones) {
    context.strokeStyle = 'rgba(255, 123, 84, 0.85)'
    context.lineWidth = 1.5
    context.strokeRect(
      zone.region.left * width,
      zone.region.top * height,
      zone.region.width * width,
      zone.region.height * height,
    )

    const lineY = (zone.region.top + zone.region.height * zone.countingLineOffset) * height
    context.beginPath()
    context.moveTo(zone.region.left * width, lineY)
    context.lineTo((zone.region.left + zone.region.width) * width, lineY)
    context.stroke()
  }

  for (const track of tracks) {
    const left = track.boundingBox.left * width
    const top = track.boundingBox.top * height
    const boxWidth = track.boundingBox.width * width
    const boxHeight = track.boundingBox.height * height

    context.strokeStyle = colorForClass(track.vehicleClass)
    context.lineWidth = 2
    context.strokeRect(left, top, boxWidth, boxHeight)

    if (track.counted) {
      const label = `${track.zoneLabel ? `${track.zoneLabel}: ` : ''}${track.vehicleClass.toUpperCase()}`
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
