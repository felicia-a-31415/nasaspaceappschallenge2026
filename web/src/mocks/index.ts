// Mock twins for every endpoint, derived from the loaded hotspots (see store.ts).
// Shapes come from src/types.ts and must stay identical to the server's.

import { cellCentre, cellIndex, distanceKm } from '../lib/geo'
import {
  dateToDay, dayToDate, dayToMonth, isMonthEnd, monthEndDay, monthRange, monthStartDay,
  periodLabel, previousMonth, SWITCH_MONTH,
} from '../lib/days'
import type {
  AboutResponse, ActivityMonth, ActivityResponse, ActivitySummary, Coverage, HotspotArrays,
  OutlookResponse, Selection, StatsResponse, StatsYear, TopAreasResponse, WeatherResponse,
} from '../types'
import { mockHotspots } from './store'

/** Fitted on the overlap years by the harmonization step (outputs/quebec/model.json). */
const CURVES: Record<number, { a: number; b: number; sigma: number }> = {
  50: { a: -0.047668911971527235, b: 1.083096985358787, sigma: 0.7815783363527793 },
  100: { a: 0.21069587208303397, b: 1.0179237762716922, sigma: 0.9990252208363363 },
  200: { a: 0.3063796623658642, b: 0.9835119328252888, sigma: 1.0811683604291271 },
}

const TERRA_ONLY_UNTIL = '2002-06'

/** The server's own label for the outlook; the page shows it as the heading. */
const OUTLOOK_LABEL = 'Outlook from past seasons and recent weather'

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
    summary: summarise(all, months, h.dataThrough),
    detail: null,
  }
}

/**
 * The server compares the last year in the range, over the months of the range, with the
 * same months in every other year (harmonize/query.py: summarize). The mock does the
 * same, down to the wording, so switching VITE_USE_MOCKS off changes nothing on screen.
 *
 * A month the record only covers part of is left out, so half a month is never weighed
 * against whole ones. Nothing but the unfinished month is left: no summary at all.
 */
const MIN_COMPARISON_YEARS = 5

function summarise(all: ActivityMonth[], chosen: ActivityMonth[], through: string): ActivitySummary | null {
  if (chosen.length === 0) return null
  const months = finishedOnly(chosen, through)
  if (months.length === 0) return null
  const first = months[0].month
  const last = months[months.length - 1].month
  const year = Number(last.slice(0, 4))
  const firstMonthNumber = Number(first.slice(0, 4)) === year ? Number(first.slice(5)) : 1
  const wanted: number[] = []
  for (let m = firstMonthNumber; m <= Number(last.slice(5)); m++) wanted.push(m)

  // Only years holding every one of those months can be compared.
  const perYear = new Map<number, { total: number; count: number }>()
  for (const row of all) {
    if (!wanted.includes(Number(row.month.slice(5)))) continue
    const y = Number(row.month.slice(0, 4))
    const seen = perYear.get(y) ?? { total: 0, count: 0 }
    seen.total += row.activity
    seen.count += 1
    perYear.set(y, seen)
  }
  const complete = [...perYear.entries()].filter(([, v]) => v.count === wanted.length)
  const here = complete.find(([y]) => y === year)
  if (!here) return null
  const others = complete.filter(([y]) => y !== year)
  if (others.length < MIN_COMPARISON_YEARS) return null

  const total = here[1].total
  const usual = median(others.map(([, v]) => v.total))
  const ratio = usual > 0 ? total / usual : null
  const higherBefore = others.filter(([y, v]) => v.total > total && y < year).map(([y]) => y)
  const label = periodLabel(year, wanted)

  return {
    year,
    months: wanted,
    total: Number(total.toFixed(1)),
    median: Number(usual.toFixed(1)),
    ratio: ratio === null ? null : Number(ratio.toFixed(2)),
    rank: others.filter(([, v]) => v.total > total).length + 1,
    years_compared: others.length,
    sentence: sentenceFor(label, total, usual, ratio,
      higherBefore.length ? Math.max(...higherBefore) : null,
      Math.min(...others.map(([y]) => y))),
  }
}

/** The chosen months, stopping before a month the record is still part-way through. */
function finishedOnly(chosen: ActivityMonth[], through: string): ActivityMonth[] {
  const unfinished = through.slice(0, 7)
  const last = chosen[chosen.length - 1].month
  if (isMonthEnd(through) || unfinished > last) return chosen
  const cap = previousMonth(unfinished)
  return chosen.filter((m) => m.month <= cap)
}

function sentenceFor(label: string, total: number, usual: number, ratio: number | null,
                     earlierHigher: number | null, firstYear: number): string {
  if (usual === 0) {
    return total === 0
      ? `No fire was detected here in ${label}. That is normal for this place.`
      : `${label} had fire here. In most years there is none.`
  }
  if (ratio !== null && ratio >= 1.5) {
    const shown = ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)
    const since = earlierHigher ? `since ${earlierHigher}` : `since records began in ${firstYear}`
    return `${label} had ${shown} times the usual amount of fire here. The most ${since}.`
  }
  if (ratio !== null && ratio <= 0.67) {
    return `${label} had less fire than usual here, about ${(ratio * 100).toFixed(0)}% of the usual amount.`
  }
  return `${label} was about normal for fire here.`
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

/**
 * A stand-in outlook, worked out the same way the server does but from raw detections
 * rather than burning squares: how the fortnight after the last day of data usually goes
 * here, from the years the newer camera has seen. Recent weather is left out, exactly as
 * the server does when NASA POWER cannot be reached.
 */
export async function outlook(selection: Selection, on?: string): Promise<OutlookResponse> {
  const h = await mockHotspots()
  const coverage = coverageFor(h, selection)
  const asOf = on && on < h.dataThrough ? on : h.dataThrough
  const window = {
    from: dayToDate(h.epoch, dateToDay(h.epoch, asOf) + 1),
    to: dayToDate(h.epoch, dateToDay(h.epoch, asOf) + 14),
  }
  const base: OutlookResponse = {
    coverage, detail: null, label: OUTLOOK_LABEL, as_of: asOf, window,
    level: null, reasons: [], history: null, recent: null, weather: null,
  }
  if (coverage === 'outside') {
    return { ...base, detail: 'There is no fire history for this place yet.' }
  }

  const inside = insideCircle(h, selection)
  const onDay = dateToDay(h.epoch, asOf)
  const firstViirsDay = dateToDay(h.epoch, '2012-02-01')

  // The same fortnight in each past year, and that year's whole total for comparison.
  const years: { window: number; recent: number; yearTotal: number }[] = []
  for (let back = 1; ; back++) {
    const sameDay = onDay - Math.round(back * 365.25)
    if (sameDay - 13 < firstViirsDay) break
    let inWindow = 0
    let inRecent = 0
    let inYear = 0
    for (const i of inside) {
      if (h.sensor[i] !== 1) continue
      const day = h.day[i]
      if (day > sameDay && day <= sameDay + 14) inWindow++
      if (day >= sameDay - 13 && day <= sameDay) inRecent++
      if (day > sameDay && day <= sameDay + 365) inYear++
    }
    years.push({ window: inWindow, recent: inRecent, yearTotal: inYear })
  }
  if (years.length < 5) {
    return { ...base, reasons: ['There are not enough past years of fire records here to give an outlook.'] }
  }

  const withFire = years.filter((y) => y.window > 0).length
  const averageFortnight = (years.reduce((sum, y) => sum + y.yearTotal, 0) * 14) / 365
  const factor = averageFortnight > 0
    ? years.reduce((sum, y) => sum + y.window, 0) / averageFortnight
    : null
  let recentNow = 0
  for (const i of inside) {
    if (h.sensor[i] === 1 && h.day[i] >= onDay - 13 && h.day[i] <= onDay) recentNow++
  }
  const recentUsual = median(years.map((y) => y.recent))

  const reasons: string[] = []
  let level: number
  if (withFire < years.length / 3) {
    level = 0
    reasons.push(`There was fire here in these two weeks in ${withFire
      ? `${withFire} of the last ${years.length} years`
      : `none of the last ${years.length} years`}.`)
  } else if (factor !== null && factor >= 2) {
    level = 2
    reasons.push(`These two weeks are usually a busy time for fire here: about ${factor.toFixed(1)} times `
      + `an average two weeks, with fire in ${withFire} of the last ${years.length} years.`)
  } else {
    level = 1
    const amount = factor === null ? '' : `, about ${factor.toFixed(1)} times an average two weeks`
    reasons.push(`There was fire here in these two weeks in ${withFire} of the last ${years.length} years${amount}.`)
  }

  if (recentNow >= Math.max(2 * recentUsual, 3)) {
    level = Math.min(2, level + 1)
    reasons.push(`The last two weeks had more fire than usual: ${recentNow} against a usual ${Math.round(recentUsual)}.`)
  }
  reasons.push('Recent weather was not available, so it is not counted.')

  return {
    ...base,
    level: (['low', 'usual', 'high'] as const)[level],
    reasons,
    history: {
      years: years.length,
      years_with_fire: withFire,
      median_activity: median(years.map((y) => y.window)),
      season_factor: factor === null ? null : Number(factor.toFixed(2)),
    },
    recent: { activity: recentNow, usual: Math.round(recentUsual) },
    weather: null,
  }
}
