export function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(safeSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
