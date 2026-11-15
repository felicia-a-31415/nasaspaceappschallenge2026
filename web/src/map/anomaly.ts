// Colour encoding B: the standardized anomaly of fire activity in each 0.1 degree cell.
//
//   x     fire-days in the cell during the chosen period (days with >= 1 detection)
//   mu    mean of x over the same calendar window in the other years of the same sensor era
//   sd    sample standard deviation over those years
//   z     (x - mu) / max(sd, SIGMA_FLOOR)
//
// The baseline never mixes sensors. MODIS and VIIRS detect different numbers of fires
// for the same burning, so a MODIS-era period is compared with MODIS-era years only and
// a VIIRS-era period with VIIRS-era years only. A period that crosses the transition has
// no single-sensor baseline and gets no anomaly.

import { monthEndDay, monthRange, monthStartDay, SWITCH_MONTH } from '../lib/days'
import { cellCentre, cellIndex } from '../lib/geo'
import type { HotspotArrays, SensorName } from '../types'
import { sliceByDay } from './field'

/** Most cells never burn, so sd is often 0. One fire-day is the smallest step x can take. */
export const SIGMA_FLOOR = 1
export const MIN_BASELINE_YEARS = 5
export const MAX_PERIOD_MONTHS = 12

/** Class boundaries in z. Seven classes: two below normal, one normal, four above. */
export const Z_BREAKS = [-1, -0.5, 0.5, 1, 2, 3]
export const Z_LABELS = ['< −1', '−1 to −0.5', '−0.5 to +0.5', '+0.5 to +1', '+1 to +2', '+2 to +3', '≥ +3']
/** Blue below, grey at normal, orange to pale yellow above: safe for colour-blind readers. */
export const Z_COLOURS: [number, number, number][] = [
  [74, 152, 208], [44, 94, 140], [96, 102, 110],
  [168, 106, 52], [224, 130, 40], [246, 188, 68], [255, 245, 182],
]
export const Z_NORMAL_CLASS = 2

export function zClass(z: number): number {
  let i = 0
  while (i < Z_BREAKS.length && z >= Z_BREAKS[i]) i++
  return i
}

export interface AnomalyCell {
  /** Centre of the cell. */
  lat: number
  lon: number
  x: number
  mean: number
  sd: number
  z: number
}

export type Anomaly =
  | { ok: true; cells: AnomalyCell[]; era: SensorName; years: number[] }
  | { ok: false; reason: string }

/** Fire-days per cell between two days, inclusive. The record is in day order. */
export function fireDays(h: HotspotArrays, firstDay: number, lastDay: number): Map<number, number> {
  const counts = new Map<number, number>()
  const slice = sliceByDay(h.day, firstDay, lastDay)
  if (!slice) return counts
  const seen = new Map<number, number>()
  for (let i = slice[0]; i < slice[1]; i++) {
    const cell = cellIndex(h.positions[i * 2 + 1], h.positions[i * 2])
    const day = h.day[i]
    if (seen.get(cell) === day) continue
    seen.set(cell, day)
    counts.set(cell, (counts.get(cell) ?? 0) + 1)
  }
  return counts
}

function shiftYears(month: string, years: number): string {
  return `${Number(month.slice(0, 4)) + years}${month.slice(4)}`
}

function eraOf(from: string, to: string): SensorName | null {
  if (to < SWITCH_MONTH) return 'MODIS'
  if (from >= SWITCH_MONTH) return 'VIIRS'
  return null
}

/** The anomaly of every cell with fire in the period or in its baseline. */
export function computeAnomaly(h: HotspotArrays, from: string, to: string): Anomaly {
  if (monthRange(from, to).length > MAX_PERIOD_MONTHS) {
    return { ok: false, reason: `Defined for periods of ${MAX_PERIOD_MONTHS} months or less.` }
  }
  const era = eraOf(from, to)
  if (!era) {
    return { ok: false, reason: `Period spans the ${SWITCH_MONTH} sensor transition: no single-sensor baseline.` }
  }
  const first = Math.max(h.minDay, monthStartDay(h.epoch, from))
  const last = Math.min(h.maxDay, monthEndDay(h.epoch, to))
  const length = last - first

  // The same calendar window in every other year the same sensor covers in full.
  const baseline: Map<number, number>[] = []
  const years: number[] = []
  for (let k = -40; k <= 40; k++) {
    if (k === 0) continue
    const f = shiftYears(from, k)
    const t = shiftYears(to, k)
    if (eraOf(f, t) !== era) continue
    const a = monthStartDay(h.epoch, f)
    if (a < h.minDay || a + length > h.maxDay) continue
    baseline.push(fireDays(h, a, a + length))
    years.push(Number(f.slice(0, 4)))
  }
  if (baseline.length < MIN_BASELINE_YEARS) {
    return { ok: false, reason: `Fewer than ${MIN_BASELINE_YEARS} baseline years from ${era} for this window.` }
  }

  const now = fireDays(h, first, last)
  const ids = new Set(now.keys())
  for (const year of baseline) for (const id of year.keys()) ids.add(id)

  const n = baseline.length
  const cells: AnomalyCell[] = []
  for (const id of ids) {
    let sum = 0
    let squares = 0
    for (const year of baseline) {
      const v = year.get(id) ?? 0
      sum += v
      squares += v * v
    }
    const mean = sum / n
    const sd = Math.sqrt(Math.max(0, (squares - n * mean * mean) / (n - 1)))
    const x = now.get(id) ?? 0
    cells.push({ ...cellCentre(id), x, mean, sd, z: (x - mean) / Math.max(sd, SIGMA_FLOOR) })
  }
  return { ok: true, cells, era, years }
}
