import type { VehicleClass } from '../types'

/** Canonical vehicle-class colors, shared by the canvas overlay and the UI legend. */
export const classColors: Record<VehicleClass, string> = {
  car: '#38bdf8',
  truck: '#fbbf24',
  bus: '#c084fc',
  motorcycle: '#4ade80',
}

export const zoneColor = '#f8fafc'
export const zoneActiveColor = '#22d3ee'
export const countingLineColor = '#fb7185'
