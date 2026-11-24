import type { VehicleClass } from '../types'

/** Vehicle-class colours, shared by the video overlay and the count board. */
export const classColors: Record<VehicleClass, string> = {
  car: '#7cc4f0',
  truck: '#f2b330',
  bus: '#c79bf2',
  motorcycle: '#46c38a',
}

/** Zone outline: road-marking white. The active zone and counting line use traffic-sign amber. */
export const zoneColor = '#eef0ea'
export const zoneActiveColor = '#ffc94d'
export const countingLineColor = '#f2b330'
