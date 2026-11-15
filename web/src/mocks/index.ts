// Mock twins for every endpoint, derived from the loaded hotspots (see store.ts).
// Shapes come from src/types.ts and must stay identical to the server's.

import { cellCentre, cellIndex, distanceKm } from '../lib/geo'
import { dayToDate, dayToMonth, formatMonth, monthEndDay, monthRange, monthStartDay, SWITCH_MONTH } from '../lib/days'
import type {
  AboutResponse, ActivityMonth, ActivityResponse, ActivitySummary, Coverage, HotspotArrays,
  Selection, StatsResponse, StatsYear, TopAreasResponse, WeatherResponse,
} from '../types'
import { mockHotspots } from './store'

/** Fitted on the overlap years by the harmonization step (outputs/quebec/model.json). */
const CURVES: Record<number, { a: number; b: number; sigma: number }> = {
  50: { a: -0.047668911971527235, b: 1.083096985358787, sigma: 0.7815783363527793 },
  100: { a: 0.21069587208303397, b: 1.0179237762716922, sigma: 0.9990252208363363 },
  200: { a: 0.3063796623658642, b: 0.9835119328252888, sigma: 1.0811683604291271 },
}

const TERRA_ONLY_UNTIL = '2002-06'

/** Lift a count from the older camera to what the newer one would have seen. */
function lift(modisCellDays: number, radiusKm: number): { activity: number; low: number; high: number } {
  if (modisCellDays <= 0) return { activity: 0, low: 0, high: 0 }
  const curve = CURVES[radiusKm] ?? CURVES[100]
  const logV = curve.a + curve.b * Math.log(modisCellDays)
  return {
    activity: Math.round(Math.exp(logV)),
    low: Math.round(Math.exp(logV - curve.sigma)),
    high: Math.round(Math.exp(logV + curve.sigma)),
  }
}

/** Indices of every hotspot inside the circle, in day order. */
function insideCircle(h: HotspotArrays, selection: Selection): number[] {
  const out: number[] = []
  const { lat, lon, radius_km } = selection
  // A cheap box first: one degree of latitude is about 111 km.
  const dLat = radius_km / 111 + 0.05
  const dLon = dLat / Math.max(0.1, Math.cos(lat * Math.PI / 180))
  for (let i = 0; i < h.count; i++) {
    const plon = h.positions[i * 2]
    const plat = h.positions[i * 2 + 1]
    if (plat < lat - dLat || plat > lat + dLat || plon < lon - dLon || plon > lon + dLon) continue
    if (distanceKm(lat, lon, plat, plon) <= radius_km) out.push(i)
  }
  return out
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Quebec is loaded, so inside the box is "preloaded"; the mocks fetch nothing on demand. */
function coverageFor(h: HotspotArrays, selection: Selection): Coverage {
  const [w, s, e, n] = h.bbox
  const { lat, lon, radius_km } = selection
  const dLat = radius_km / 111
  const dLon = dLat / Math.max(0.1, Math.cos(lat * Math.PI / 180))
  if (lat + dLat < s || lat - dLat > n || lon + dLon < w || lon - dLon > e) return 'outside'
  if (lat - dLat < s || lat + dLat > n || lon - dLon < w || lon + dLon > e) return 'partial'
  return 'preloaded'
}

export async function about(): Promise<AboutResponse> {
  const h = await mockHotspots()
  return {
    radii_km: [50, 100, 200],
    data_through: h.dataThrough,
    model: {
      kind: 'power curve on a log scale',
      by_radius: CURVES,
      cell_deg: 0.1,
      switch_month: SWITCH_MONTH,
      fit_months: ['2012-02', '2025-12'],
    },
    validation: [],
    circle_validation: [],
  }
}

/** Corrected monthly fire activity inside the circle, plus one plain sentence. */
export async function activity(selection: Selection): Promise<ActivityResponse> {
  const h = await mockHotspots()
  const coverage = coverageFor(h, selection)
  if (coverage === 'outside') {
    return {
      coverage, progress: null, curve_source: 'quebec', data_through: h.dataThrough,
      months: [], summary: null, detail: 'There is no fire history for this place yet.',
    }
  }

  const indices = insideCircle(h, selection)
  // Burning squares, counted once per day, kept apart by camera.
  const seen = new Map<string, Set<string>>()
  for (const i of indices) {
    const month = dayToMonth(h.epoch, h.day[i])
    const key = `${h.sensor[i]}|${month}`
    let set = seen.get(key)
    if (!set) seen.set(key, (set = new Set()))
    set.add(`${h.day[i]}|${cellIndex(h.positions[i * 2 + 1], h.positions[i * 2])}`)
  }

  const firstMonth = dayToMonth(h.epoch, h.minDay)
  const lastMonth = dayToMonth(h.epoch, h.maxDay)
  const all: ActivityMonth[] = monthRange(firstMonth, lastMonth).map((month) => {
    const estimated = month < SWITCH_MONTH
    const raw = (seen.get(`${estimated ? 0 : 1}|${month}`)?.size) ?? 0
    const value = estimated ? lift(raw, selection.radius_km) : { activity: raw, low: raw, high: raw }
    return { month, ...value, estimated, terra_only: month <= TERRA_ONLY_UNTIL, median: 0 }
  })

  // The usual value for each calendar month at this place.
  const byCalendarMonth = new Map<string, number[]>()
  for (const m of all) {
    const key = m.month.slice(5)
    const list = byCalendarMonth.get(key) ?? []
    list.push(m.activity)
    byCalendarMonth.set(key, list)
  }
  for (const m of all) m.median = median(byCalendarMonth.get(m.month.slice(5)) ?? [])

  const from = selection.from ?? firstMonth
  const to = selection.to ?? lastMonth
  const months = all.filter((m) => m.month >= from && m.month <= to)

  return {
    coverage,
    progress: null,
    curve_source: 'quebec',
    data_through: h.dataThrough,
    months,
    summary: summarise(all, months),
    detail: null,
  }
}

/** Compare the chosen stretch with the same stretch in every other year. */
function summarise(all: ActivityMonth[], months: ActivityMonth[]): ActivitySummary | null {
  if (months.length === 0) return null
  const total = months.reduce((sum, m) => sum + m.activity, 0)
  const span = months.length
  const startCalendarMonth = months[0].month.slice(5)

  // Every window of the same length starting in the same calendar month.
  const windows: { year: number; total: number }[] = []
  for (let i = 0; i + span <= all.length; i++) {
    if (all[i].month.slice(5) !== startCalendarMonth) continue
    let sum = 0
    for (let j = i; j < i + span; j++) sum += all[j].activity
    windows.push({ year: Number(all[i].month.slice(0, 4)), total: sum })
  }
  if (windows.length < 3) return null

  const usual = median(windows.map((w) => w.total))
  const ratio = usual > 0 ? Number((total / usual).toFixed(1)) : null
  const sorted = [...windows].sort((a, b) => b.total - a.total)
  const rank = sorted.findIndex((w) => w.year === Number(months[0].month.slice(0, 4))) + 1
  const firstYear = Number(all[0].month.slice(0, 4))

  const first = months[0].month
  const lastMonth = months[span - 1].month
  const sameYear = first.slice(0, 4) === lastMonth.slice(0, 4)
  const when = span === 1
    ? formatMonth(first)
    : sameYear
      ? `${formatMonth(first).split(' ')[0]} to ${formatMonth(lastMonth)}`
      : `${formatMonth(first)} to ${formatMonth(lastMonth)}`
  let sentence: string
  if (total === 0) {
    sentence = `${when} had no fire recorded here.`
  } else if (ratio === null) {
    sentence = `${when} had fire activity of ${total} here, where the usual amount is none at all.`
  } else if (ratio >= 1.2) {
    sentence = `${when} had ${ratio} times the usual amount of fire here.`
  } else if (ratio <= 0.8) {
    sentence = `${when} had ${ratio} times the usual amount of fire here, less than normal.`
  } else {
    sentence = `${when} had about the usual amount of fire here.`
  }
  if (total > 0 && rank === 1) {
    sentence += ` The most since records began in ${firstYear}.`
  } else if (total > 0 && rank > 0) {
    sentence += ` Rank ${rank} of the ${windows.length} years on record.`
  }
  return {
    year: Number(months[0].month.slice(0, 4)),
    months: months.map((m) => Number(m.month.slice(5))),
    total,
    median: usual,
    ratio,
    rank: rank > 0 ? rank : windows.length,
    years_compared: windows.length,
    sentence,
  }
}

/** Raw hotspot statistics: never corrected, never comparable across 2012. */
export async function stats(selection: Selection): Promise<StatsResponse> {
  const h = await mockHotspots()
  const coverage = coverageFor(h, selection)
  const empty: StatsResponse = {
    coverage, detail: 'There is no fire history for this place yet.', detections: 0,
    mean_frp: null, sum_frp: 0, peak_day: null, by_year: [], typical_year: null, this_year: null,
  }
  if (coverage === 'outside') return empty

  const inCircle = insideCircle(h, selection)
  const fromDay = selection.from ? monthStartDay(h.epoch, selection.from) : -Infinity
  const toDay = selection.to ? monthEndDay(h.epoch, selection.to) : Infinity

  const perDay = new Map<number, number>()
  const perYear = new Map<number, { detections: number; sum: number }>()
  const perYearAll = new Map<number, { detections: number; sum: number }>()
  const thisYear = new Date().getUTCFullYear()
  let detections = 0
  let sum = 0

  for (const i of inCircle) {
    const day = h.day[i]
    const year = Number(dayToDate(h.epoch, day).slice(0, 4))
    const allRow = perYearAll.get(year) ?? { detections: 0, sum: 0 }
    allRow.detections += 1
    allRow.sum += h.frp[i]
    perYearAll.set(year, allRow)
    if (day < fromDay || day > toDay) continue
    detections += 1
    sum += h.frp[i]
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    const row = perYear.get(year) ?? { detections: 0, sum: 0 }
    row.detections += 1
    row.sum += h.frp[i]
    perYear.set(year, row)
  }

  let peak: { date: string; detections: number } | null = null
  for (const [day, n] of perDay) {
    if (!peak || n > peak.detections) peak = { date: dayToDate(h.epoch, day), detections: n }
  }

  const firstYear = Number(dayToDate(h.epoch, Math.max(fromDay, h.minDay)).slice(0, 4))
  const lastYear = Number(dayToDate(h.epoch, Math.min(toDay, h.maxDay)).slice(0, 4))
  const by_year: StatsYear[] = []
  for (let year = firstYear; year <= lastYear; year++) {
    const row = perYear.get(year) ?? { detections: 0, sum: 0 }
    by_year.push({
      year,
      detections: row.detections,
      mean_frp: row.detections ? Number((row.sum / row.detections).toFixed(1)) : null,
      sum_frp: Number(row.sum.toFixed(1)),
      sensor: year < 2012 ? 'MODIS' : 'VIIRS',
    })
  }

  // The typical year is measured by the same camera as this year.
  const viirsYears = [...perYearAll.entries()].filter(([y]) => y >= 2012 && y < thisYear)
  const current = perYearAll.get(thisYear)

  return {
    coverage,
    detail: null,
    detections,
    mean_frp: detections ? Number((sum / detections).toFixed(1)) : null,
    sum_frp: Number(sum.toFixed(1)),
    peak_day: peak,
    by_year,
    typical_year: viirsYears.length
      ? {
        detections: Math.round(median(viirsYears.map(([, r]) => r.detections))),
        sum_frp: Number(median(viirsYears.map(([, r]) => r.sum)).toFixed(1)),
        years: viirsYears.length,
      }
      : null,
    this_year: {
      year: thisYear,
      detections: current?.detections ?? 0,
      mean_frp: current ? Number((current.sum / current.detections).toFixed(1)) : null,
      sum_frp: Number((current?.sum ?? 0).toFixed(1)),
    },
  }
}

/** The squares in Quebec with the highest summed intensity in the range. */
export async function topAreas(range: { from?: string; to?: string; limit?: number }): Promise<TopAreasResponse> {
  const h = await mockHotspots()
  const fromDay = range.from ? monthStartDay(h.epoch, range.from) : -Infinity
  const toDay = range.to ? monthEndDay(h.epoch, range.to) : Infinity
  // Rank within the newer camera whenever the range reaches it.
  const newerOnly = (range.to ?? '9999-12') >= SWITCH_MONTH
  const sensor = newerOnly ? 'VIIRS' : 'MODIS'

  const cells = new Map<number, { sum: number; detections: number }>()
  for (let i = 0; i < h.count; i++) {
    if (h.day[i] < fromDay || h.day[i] > toDay) continue
    if (newerOnly ? h.sensor[i] !== 1 : h.sensor[i] !== 0) continue
    const key = cellIndex(h.positions[i * 2 + 1], h.positions[i * 2])
    const row = cells.get(key) ?? { sum: 0, detections: 0 }
    row.sum += h.frp[i]
    row.detections += 1
    cells.set(key, row)
  }

  const areas = [...cells.entries()]
    .sort((a, b) => b[1].sum - a[1].sum)
    .slice(0, range.limit ?? 10)
    .map(([key, row]) => ({
      ...cellCentre(key),
      sum_frp: Number(row.sum.toFixed(1)),
      detections: row.detections,
      sensor: sensor as 'MODIS' | 'VIIRS',
    }))
  return { areas }
}

/**
 * Stand-in weather. NASA POWER is a server-side call, so there is nothing real to
 * show until B6 lands; the source is labelled as sample data so nobody reads these
 * numbers as measurements.
 */
export async function weather(selection: Selection): Promise<WeatherResponse> {
  const h = await mockHotspots()
  const from = selection.from ?? dayToMonth(h.epoch, h.maxDay)
  const to = selection.to ?? from
  const days: WeatherResponse['days'] = []
  for (const month of monthRange(from, to)) {
    const start = monthStartDay(h.epoch, month)
    const end = monthEndDay(h.epoch, month)
    for (let day = start; day <= end; day++) {
      // A smooth seasonal shape plus a repeatable wobble, so the strip looks like weather.
      const date = dayToDate(h.epoch, day)
      const doy = (day % 365) / 365
      const wobble = Math.sin(day * 1.7) * 0.5 + Math.sin(day * 0.31) * 0.5
      const season = Math.sin((doy - 0.3) * 2 * Math.PI)
      days.push({
        date,
        precip_mm: Math.max(0, Number((wobble * 6 + 1.5).toFixed(1))),
        temp_max_c: Number((8 + season * 16 + wobble * 3).toFixed(1)),
        wind_ms: Number((3.5 + wobble * 2).toFixed(1)),
        humidity_pct: Number(Math.min(100, Math.max(15, 60 + wobble * 25 - season * 10)).toFixed(0)),
      })
    }
  }
  return { source: 'NASA POWER (sample data, not yet live)', days }
}
