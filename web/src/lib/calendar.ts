// The burning-activity calendar: one row per year, one column per day of the year.
//
// Each day carries two measured values for the area of interest:
//   cells   0.1 degree cells with >= 1 detection that day (the unit the harmonization counts in)
//   frp     sum of fire radiative power over the day's detections, MW
// and the standardized anomaly of `cells`:
//   z = (cells - mu) / max(sd, 1), where mu and sd are taken over the other years of the
//   same sensor era, on days of the year within +/- WINDOW_DAYS.

import { dateToDay, SWITCH_MONTH } from './days'
import { cellIndex, distanceKm } from './geo'
import type { HotspotArrays } from '../types'

export const SLOTS = 366
export const WINDOW_DAYS = 7
const MIN_SAMPLES = 45

/** First slot of each month in a leap-year layout, so months line up in every row. */
export const MONTH_STARTS = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface Calendar {
  years: number[]
  /** years x SLOTS, row by row. NaN where the record holds no such day. */
  cells: Float32Array
  frp: Float32Array
  /** NaN where there is no day or too little baseline. */
  z: Float32Array
  mean: Float32Array
  sd: Float32Array
  samples: Uint16Array
  /** 1 where the day was observed by VIIRS, 0 by MODIS. */
  viirs: Uint8Array
  maxCells: number
  maxFrp: number
  /** Cell-days per year, for the margin. */
  yearCells: number[]
}

export function slotOf(month: number, dayOfMonth: number): number {
  return MONTH_STARTS[month - 1] + dayOfMonth - 1
}

/** YYYY-MM-DD for a slot in a year, or null for 29 February in a common year. */
export function slotDate(year: number, slot: number): string | null {
  let month = 11
  while (MONTH_STARTS[month] > slot) month--
  const day = slot - MONTH_STARTS[month] + 1
  const date = new Date(Date.UTC(year, month, day))
  if (date.getUTCMonth() !== month) return null
  return date.toISOString().slice(0, 10)
}

export function buildCalendar(
  h: HotspotArrays,
  circle: { lat: number; lon: number; radius_km: number } | null,
): Calendar {
  const epochMs = Date.parse(h.epoch + 'T00:00:00Z')
  const firstYear = new Date(epochMs + h.minDay * 86_400_000).getUTCFullYear()
  const lastYear = new Date(epochMs + h.maxDay * 86_400_000).getUTCFullYear()
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i)
  const size = years.length * SLOTS
  const cells = new Float32Array(size).fill(NaN)
  const frp = new Float32Array(size).fill(NaN)
  const viirs = new Uint8Array(size)
  const switchDay = dateToDay(h.epoch, `${SWITCH_MONTH}-01`)

  // Every day the record covers is a valid slot, with zero until a detection says otherwise.
  const slotOfDay = new Int32Array(Math.max(0, h.maxDay - h.minDay + 1))
  for (let day = h.minDay; day <= h.maxDay; day++) {
    const date = new Date(epochMs + day * 86_400_000)
    const at = (date.getUTCFullYear() - firstYear) * SLOTS + slotOf(date.getUTCMonth() + 1, date.getUTCDate())
    slotOfDay[day - h.minDay] = at
    cells[at] = 0
    frp[at] = 0
    viirs[at] = day >= switchDay ? 1 : 0
  }

  // A cheap box first, so the exact distance is only worked out near the circle.
  const latReach = circle ? circle.radius_km / 110.5 : 0
  const lonReach = circle ? circle.radius_km / (111.3 * Math.cos((circle.lat * Math.PI) / 180)) : 0
  let current = -1
  const active = new Set<number>()
  const flush = () => {
    if (current >= 0) cells[slotOfDay[current - h.minDay]] = active.size
    active.clear()
  }
  for (let i = 0; i < h.count; i++) {
    const lon = h.positions[i * 2]
    const lat = h.positions[i * 2 + 1]
    if (circle) {
      if (Math.abs(lat - circle.lat) > latReach || Math.abs(lon - circle.lon) > lonReach) continue
      if (distanceKm(circle.lat, circle.lon, lat, lon) > circle.radius_km) continue
    }
    const day = h.day[i]
    if (day !== current) {
      flush()
      current = day
    }
    active.add(cellIndex(lat, lon))
    frp[slotOfDay[day - h.minDay]] += h.frp[i]
  }
  flush()

  const z = new Float32Array(size).fill(NaN)
  const mean = new Float32Array(size).fill(NaN)
  const sd = new Float32Array(size).fill(NaN)
  const samples = new Uint16Array(size)
  for (let slot = 0; slot < SLOTS; slot++) {
    const lo = Math.max(0, slot - WINDOW_DAYS)
    const hi = Math.min(SLOTS - 1, slot + WINDOW_DAYS)
    // Sums over the window for each year and sensor, so leaving one year out is a subtraction.
    const n = [new Float64Array(years.length), new Float64Array(years.length)]
    const s = [new Float64Array(years.length), new Float64Array(years.length)]
    const q = [new Float64Array(years.length), new Float64Array(years.length)]
    const total = [{ n: 0, s: 0, q: 0 }, { n: 0, s: 0, q: 0 }]
    for (let y = 0; y < years.length; y++) {
      for (let d = lo; d <= hi; d++) {
        const v = cells[y * SLOTS + d]
        if (Number.isNaN(v)) continue
        const e = viirs[y * SLOTS + d]
        n[e][y]++; s[e][y] += v; q[e][y] += v * v
        total[e].n++; total[e].s += v; total[e].q += v * v
      }
    }
    for (let y = 0; y < years.length; y++) {
      const at = y * SLOTS + slot
      const v = cells[at]
      if (Number.isNaN(v)) continue
      const e = viirs[at]
      const count = total[e].n - n[e][y]
      if (count < MIN_SAMPLES) continue
      const m = (total[e].s - s[e][y]) / count
      const variance = Math.max(0, ((total[e].q - q[e][y]) - count * m * m) / (count - 1))
      samples[at] = count
      mean[at] = m
      sd[at] = Math.sqrt(variance)
      z[at] = (v - m) / Math.max(sd[at], 1)
    }
  }

  let maxCells = 0
  let maxFrp = 0
  const yearCells = years.map(() => 0)
  for (let i = 0; i < size; i++) {
    if (Number.isNaN(cells[i])) continue
    if (cells[i] > maxCells) maxCells = cells[i]
    if (frp[i] > maxFrp) maxFrp = frp[i]
    yearCells[Math.floor(i / SLOTS)] += cells[i]
  }
  return { years, cells, frp, z, mean, sd, samples, viirs, maxCells, maxFrp, yearCells }
}

// --- the calendar as people read it: one square per month ---------------------------

export interface MonthCell {
  year: number
  /** 1 to 12. */
  month: number
  /** False where the record holds no day of this month. */
  exists: boolean
  viirs: boolean
  /** Sum of fire radiative power over the month, MW. */
  frp: number
  /** Active 0.1 degree cells, added up over the month's days. */
  cellDays: number
  /** Days with at least one detection. */
  fireDays: number
  /** The slot of the busiest day, or -1 when nothing burned. */
  peakSlot: number
  /** Mean cell-days of the same month in the same sensor's other years; null with too few. */
  usual: number | null
  z: number | null
}

export interface MonthGrid {
  years: number[]
  /** years x 12, row by row. */
  cells: MonthCell[]
  maxFrp: number
  /** Days with fire in each year, for the margin. */
  yearFireDays: number[]
}

const MIN_YEARS = 5

export function monthSlots(month: number): [number, number] {
  return [MONTH_STARTS[month - 1], month === 12 ? SLOTS : MONTH_STARTS[month]]
}

/** Roll the daily calendar up to months, each compared with the same month in other years. */
export function monthGrid(calendar: Calendar): MonthGrid {
  const { years } = calendar
  const cells: MonthCell[] = []
  for (let row = 0; row < years.length; row++) {
    for (let month = 1; month <= 12; month++) {
      const [a, b] = monthSlots(month)
      const cell: MonthCell = {
        year: years[row], month, exists: false, viirs: false, frp: 0, cellDays: 0, fireDays: 0, peakSlot: -1, usual: null, z: null,
      }
      let peak = 0
      for (let slot = a; slot < b; slot++) {
        const at = row * SLOTS + slot
        const v = calendar.cells[at]
        if (Number.isNaN(v)) continue
        cell.exists = true
        cell.viirs = calendar.viirs[at] === 1
        cell.frp += calendar.frp[at]
        cell.cellDays += v
        if (v > 0) cell.fireDays++
        if (v > peak) {
          peak = v
          cell.peakSlot = slot
        }
      }
      cells.push(cell)
    }
  }

  for (let month = 0; month < 12; month++) {
    for (let row = 0; row < years.length; row++) {
      const cell = cells[row * 12 + month]
      if (!cell.exists) continue
      let n = 0
      let sum = 0
      let squares = 0
      for (let other = 0; other < years.length; other++) {
        const c = cells[other * 12 + month]
        if (other === row || !c.exists || c.viirs !== cell.viirs) continue
        n++
        sum += c.cellDays
        squares += c.cellDays * c.cellDays
      }
      if (n < MIN_YEARS) continue
      const mean = sum / n
      const sd = Math.sqrt(Math.max(0, (squares - n * mean * mean) / (n - 1)))
      cell.usual = mean
      cell.z = (cell.cellDays - mean) / Math.max(sd, 1)
    }
  }

  return {
    years,
    cells,
    maxFrp: Math.max(0, ...cells.map((c) => c.frp)),
    yearFireDays: years.map((_, row) => cells.slice(row * 12, row * 12 + 12).reduce((sum, c) => sum + c.fireDays, 0)),
  }
}
