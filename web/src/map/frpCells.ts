// Encoding A, zoomed out: summed fire radiative power per 0.1 degree cell over the
// chosen period, in fixed decade classes. A cell is a bounded, measured quantity; a
// blurred density surface is not.

import { cellCentre, cellIndex } from '../lib/geo'
import type { HotspotArrays } from '../types'
import { rampColour } from './colourRamp'
import { sliceByDay } from './field'

export interface FrpCell {
  lat: number
  lon: number
  /** Sum of FRP over the cell's detections in the period, MW. */
  sumFrp: number
  detections: number
}

/** Lower bounds of the classes above the first, in MW. */
export const FRP_CLASS_BREAKS = [10, 100, 1000, 10_000, 100_000]
export const FRP_CLASS_LABELS = ['< 10', '10 – 100', '100 – 1 k', '1 k – 10 k', '10 k – 100 k', '≥ 100 k']
export const FRP_CLASS_COLOURS = FRP_CLASS_LABELS.map((_, i) => rampColour(i / (FRP_CLASS_LABELS.length - 1)))

export function frpClass(sumFrp: number): number {
  let i = 0
  while (i < FRP_CLASS_BREAKS.length && sumFrp >= FRP_CLASS_BREAKS[i]) i++
  return i
}

/** Every cell with a detection between two days, inclusive. */
export function frpCells(h: HotspotArrays, firstDay: number, lastDay: number): FrpCell[] {
  const slice = sliceByDay(h.day, firstDay, lastDay)
  if (!slice) return []
  const sums = new Map<number, { sumFrp: number; detections: number }>()
  for (let i = slice[0]; i < slice[1]; i++) {
    const id = cellIndex(h.positions[i * 2 + 1], h.positions[i * 2])
    const cell = sums.get(id)
    if (cell) { cell.sumFrp += h.frp[i]; cell.detections++ } else sums.set(id, { sumFrp: h.frp[i], detections: 1 })
  }
  return [...sums].map(([id, value]) => ({ ...cellCentre(id), ...value }))
}
