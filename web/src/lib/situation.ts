// The situation board's arithmetic. Everything here is counted from the detections the
// page already holds, so stepping the as-of day asks the server nothing.
//
// The record is daily: a detection carries its acquisition date and no time. "Day 0" is
// the as-of day itself, never "the last 24 hours".

import { sliceByDay } from '../map/field'
import { offset } from '../places'
import type { HotspotArrays, SensorName } from '../types'
import { dateToDay, dayToDate } from './days'
import { cellCentre, cellIndex, distanceKm } from './geo'

/** How far back the board looks from the as-of day, inclusive of it. */
export const WINDOW_DAYS = 7
/** The daily chart in the panel. */
export const CHART_DAYS = 14
/** How far back to look for the last detection when the window holds none. */
const LAST_SEEN_DAYS = 3660

/** Age classes of a detection, in days before the as-of day. */
export const AGE_CLASSES = [
  { id: 'd0', label: 'On the chosen day', maxAge: 0 },
  { id: 'd2', label: '1–2 days before', maxAge: 2 },
  { id: 'd6', label: '3–6 days before', maxAge: WINDOW_DAYS - 1 },
] as const

/** One colour per age class, newest hottest. The map and every key to it read these. */
export const AGE_COLOURS: [number, number, number][] = [[255, 72, 56], [255, 162, 24], [236, 214, 128]]

/** Which age class a detection `age` days old falls in: 0, 1 or 2. */
export function ageClass(age: number): 0 | 1 | 2 {
  return age <= 0 ? 0 : age <= 2 ? 1 : 2
}

/**
 * The detections the board counts: the whole region, or one circle. Both are in day
 * order, so any stretch of days is two binary searches.
 */
export interface Scope {
  day: Float32Array
  frp: Float32Array
  /** Position in the full record of each entry. Null when the scope is the full record. */
  index: Int32Array | null
}

export function regionScope(h: HotspotArrays): Scope {
  return { day: h.day, frp: h.frp, index: null }
}

/** Every detection within `radiusKm` of a point, gathered once per circle. */
export function circleScope(h: HotspotArrays, lat: number, lon: number, radiusKm: number): Scope {
  const dLat = radiusKm / 111 + 0.05
  const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180))
  const found: number[] = []
  for (let i = 0; i < h.count; i++) {
    const plon = h.positions[i * 2]
    const plat = h.positions[i * 2 + 1]
    if (plat < lat - dLat || plat > lat + dLat || plon < lon - dLon || plon > lon + dLon) continue
    if (distanceKm(lat, lon, plat, plon) <= radiusKm) found.push(i)
  }
  const index = Int32Array.from(found)
  const day = new Float32Array(index.length)
  const frp = new Float32Array(index.length)
  for (let k = 0; k < index.length; k++) {
    day[k] = h.day[index[k]]
    frp[k] = h.frp[index[k]]
  }
  return { day, frp, index }
}

export interface Tally {
  detections: number
  sumFrp: number
  maxFrp: number
}

/** Detections and their power from `first` to `last` day, inclusive. */
export function tally(scope: Scope, first: number, last: number): Tally {
  const slice = sliceByDay(scope.day, first, last)
  const out = { detections: 0, sumFrp: 0, maxFrp: 0 }
  if (!slice) return out
  for (let k = slice[0]; k < slice[1]; k++) {
    const power = scope.frp[k]
    out.detections++
    out.sumFrp += power
    if (power > out.maxFrp) out.maxFrp = power
  }
  return out
}

/** Detections on each day from `first` to `last`, inclusive. */
export function dailyCounts(scope: Scope, first: number, last: number): number[] {
  const out = new Array<number>(Math.max(0, last - first + 1)).fill(0)
  const slice = sliceByDay(scope.day, first, last)
  if (!slice) return out
  for (let k = slice[0]; k < slice[1]; k++) out[Math.round(scope.day[k]) - first]++
  return out
}

/** The most recent day at or before `asOf` with a detection in the scope, or null. */
export function lastSeen(scope: Scope, asOf: number): number | null {
  const slice = sliceByDay(scope.day, asOf - LAST_SEEN_DAYS, asOf)
  if (!slice || slice[1] === slice[0]) return null
  return Math.round(scope.day[slice[1] - 1])
}

export interface Nearest {
  km: number
  /** Compass point from the centre towards the detection. */
  toward: string
  day: number
  frp: number
  lat: number
  lon: number
}

/** The detection closest to a point, among every detection in the region from `first` to `last`. */
export function nearest(h: HotspotArrays, lat: number, lon: number, first: number, last: number): Nearest | null {
  const slice = sliceByDay(h.day, first, last)
  if (!slice) return null
  let best = -1
  let bestKm = Infinity
  for (let i = slice[0]; i < slice[1]; i++) {
    const km = distanceKm(lat, lon, h.positions[i * 2 + 1], h.positions[i * 2])
    if (km < bestKm) { bestKm = km; best = i }
  }
  if (best < 0) return null
  const plat = h.positions[best * 2 + 1]
  const plon = h.positions[best * 2]
  return {
    km: bestKm, toward: offset(lat, lon, plat, plon).toward,
    day: Math.round(h.day[best]), frp: h.frp[best], lat: plat, lon: plon,
  }
}

export interface SeasonToDate {
  sensor: SensorName
  year: number
  /** 1 January of the as-of year to the as-of day. */
  detections: number
  /** The same stretch of the calendar in every other year the same sensor covers. */
  others: { year: number; detections: number }[]
  median: number
  /** Null when the median is zero. */
  ratio: number | null
  /** 1 is the highest. */
  rank: number
}

/** The first whole day of VIIRS in the record's terms: the same switch the page marks everywhere. */
const SWITCH_DATE = '2012-02-01'

/**
 * This year so far against the same dates in other years. Raw counts are only compared
 * within one sensor, so the years are those on the as-of day's side of February 2012.
 */
export function seasonToDate(scope: Scope, epoch: string, asOf: number, recordStart: number, recordEnd: number): SeasonToDate | null {
  const date = dayToDate(epoch, asOf)
  const year = Number(date.slice(0, 4))
  const switchDay = dateToDay(epoch, SWITCH_DATE)
  const viirs = asOf >= switchDay
  const into = asOf - dateToDay(epoch, `${year}-01-01`)
  const firstYear = Number(dayToDate(epoch, viirs ? switchDay : recordStart).slice(0, 4)) + (viirs ? 0 : 1)
  const lastYear = viirs ? Number(dayToDate(epoch, recordEnd).slice(0, 4)) : Number(SWITCH_DATE.slice(0, 4)) - 1

  const others: { year: number; detections: number }[] = []
  let mine = 0
  for (let y = firstYear; y <= lastYear; y++) {
    const start = dateToDay(epoch, `${y}-01-01`)
    const end = start + into
    // A year the record does not reach this far into cannot be compared.
    if (end > recordEnd) continue
    const n = tally(scope, start, end).detections
    if (y === year) mine = n
    else others.push({ year: y, detections: n })
  }
  if (others.length < 3) return null
  const sorted = others.map((o) => o.detections).sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    sensor: viirs ? 'VIIRS' : 'MODIS',
    year, detections: mine, others, median,
    ratio: median > 0 ? mine / median : null,
    rank: 1 + others.filter((o) => o.detections > mine).length,
  }
}

export interface ActiveCell {
  lat: number
  lon: number
  sumFrp: number
  detections: number
  /** Days before the as-of day that the cell was last seen burning: 0 is the as-of day. */
  lastAge: number
  /** How many separate days in the window the cell had a detection. */
  daysActive: number
}

/** The 0.1 degree cells with the most fire power from `first` to `asOf`, highest first. */
export function activeCells(h: HotspotArrays, first: number, asOf: number, limit: number): ActiveCell[] {
  const slice = sliceByDay(h.day, first, asOf)
  if (!slice) return []
  const cells = new Map<number, { sumFrp: number; detections: number; last: number; days: Set<number> }>()
  for (let i = slice[0]; i < slice[1]; i++) {
    const key = cellIndex(h.positions[i * 2 + 1], h.positions[i * 2])
    const day = Math.round(h.day[i])
    const cell = cells.get(key)
    if (cell) {
      cell.sumFrp += h.frp[i]
      cell.detections++
      if (day > cell.last) cell.last = day
      cell.days.add(day)
    } else {
      cells.set(key, { sumFrp: h.frp[i], detections: 1, last: day, days: new Set([day]) })
    }
  }
  return [...cells.entries()]
    .sort((a, b) => b[1].sumFrp - a[1].sumFrp)
    .slice(0, limit)
    .map(([key, cell]) => ({
      ...cellCentre(key),
      sumFrp: cell.sumFrp, detections: cell.detections,
      lastAge: asOf - cell.last, daysActive: cell.days.size,
    }))
}

export interface Situation {
  asOf: number
  /** The as-of day, YYYY-MM-DD. */
  date: string
  /** True when the counts are for the circle, false for the whole region. */
  local: boolean
  day0: Tally
  last3: Tally
  last7: Tally
  /** The seven days before the window, for the trend. */
  prior7: Tally
  /** One count per day, oldest first, ending on the as-of day. */
  daily: number[]
  /** Null when the scope has no detection in the last ten years. */
  lastSeen: number | null
  nearest: Nearest | null
  season: SeasonToDate | null
}

/** Everything the board says about a scope on a day. */
export function situation(
  h: HotspotArrays, scope: Scope, asOf: number, centre: { lat: number; lon: number } | null,
): Situation {
  const first = asOf - (WINDOW_DAYS - 1)
  return {
    asOf,
    date: dayToDate(h.epoch, asOf),
    local: scope.index !== null,
    day0: tally(scope, asOf, asOf),
    last3: tally(scope, asOf - 2, asOf),
    last7: tally(scope, first, asOf),
    prior7: tally(scope, first - WINDOW_DAYS, first - 1),
    daily: dailyCounts(scope, asOf - (CHART_DAYS - 1), asOf),
    lastSeen: lastSeen(scope, asOf),
    nearest: centre ? nearest(h, centre.lat, centre.lon, first, asOf) : null,
    season: seasonToDate(scope, h.epoch, asOf, h.minDay, h.maxDay),
  }
}
