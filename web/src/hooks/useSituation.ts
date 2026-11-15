import { useMemo } from 'react'
import { getOutlook, getWeather } from '../api'
import { dateToDay, dayToDate, dayToMonth } from '../lib/days'
import {
  activeCells, circleScope, dailyCounts, regionScope, situation, WINDOW_DAYS,
} from '../lib/situation'
import type { ActiveCell, Situation } from '../lib/situation'
import type { HotspotArrays, OutlookResponse, TopArea, WeatherDay, WeatherResponse } from '../types'
import type { View } from '../view'
import { useSelectionQuery } from './useSelectionQuery'
import type { QueryState } from './useSelectionQuery'

/** How many active cells the board ranks and numbers on the map. */
const CELL_LIMIT = 8

export interface SituationState {
  /** The as-of day, in days since the epoch, held inside the record. */
  asOfDay: number
  /** The as-of day is the last day of the record. */
  latest: boolean
  /** First day the map draws. */
  fromDay: number
  board: Situation
  /** The region's most active 0.1 degree cells in the window, whatever the circle. */
  cells: ActiveCell[]
  /** The same cells in the shape the map outlines and numbers. */
  areas: TopArea[]
  /** The as-of year, a count per day from 1 January, for the day strip. */
  year: { first: number; counts: number[]; days: number }
  outlook: QueryState<OutlookResponse>
  /** The window's days, oldest first; a day NASA POWER has not published yet is all nulls. */
  weather: QueryState<WeatherDay[]>
}

const askOutlook = (key: { lat: number; lon: number; radius_km: number; on: string }, signal: AbortSignal) =>
  getOutlook({ lat: key.lat, lon: key.lon, radius_km: key.radius_km }, signal, key.on)

const askWeather = (key: { lat: number; lon: number; radius_km: number; from: string; to: string }, signal: AbortSignal) =>
  getWeather(key, signal)

/**
 * The situation board for one day. Counts come from the detections already loaded, so
 * the board keeps up with the day strip as it is dragged; only the outlook and the
 * weather are asked of the server, once the day has settled. Null while the record is
 * loading or the board is not the view on screen.
 */
export function useSituation(hotspots: HotspotArrays | null, view: View): SituationState | null {
  const active = view.mode === 'shift' && hotspots !== null
  const h = active ? hotspots : null
  const { lat, lon, radius_km: radiusKm, on } = view

  const asOfDay = h
    ? Math.min(h.maxDay, Math.max(h.minDay, on ? dateToDay(h.epoch, on) : h.maxDay))
    : 0
  const fromDay = asOfDay - (WINDOW_DAYS - 1)

  // Gathering a circle walks the whole record, so it is done once per circle, not per day.
  const scope = useMemo(() => {
    if (!h) return null
    return lat !== null && lon !== null ? circleScope(h, lat, lon, radiusKm) : regionScope(h)
  }, [h, lat, lon, radiusKm])

  const board = useMemo(
    () => (h && scope ? situation(h, scope, asOfDay, lat !== null && lon !== null ? { lat, lon } : null) : null),
    [h, scope, asOfDay, lat, lon],
  )

  const cells = useMemo(() => (h ? activeCells(h, fromDay, asOfDay, CELL_LIMIT) : []), [h, fromDay, asOfDay])
  const areas = useMemo<TopArea[]>(() => cells.map((cell) => ({
    lat: cell.lat, lon: cell.lon, sum_frp: cell.sumFrp, detections: cell.detections, sensor: 'VIIRS',
  })), [cells])

  const yearOf = h ? Number(dayToDate(h.epoch, asOfDay).slice(0, 4)) : 0
  const year = useMemo(() => {
    if (!h || !scope) return { first: 0, counts: [], days: 0 }
    const first = dateToDay(h.epoch, `${yearOf}-01-01`)
    const days = dateToDay(h.epoch, `${yearOf + 1}-01-01`) - first
    return { first, days, counts: dailyCounts(scope, first, Math.min(first + days - 1, h.maxDay)) }
  }, [h, scope, yearOf])

  const date = h ? dayToDate(h.epoch, asOfDay) : ''
  const outlookKey = useMemo(
    () => (h && lat !== null && lon !== null ? { lat, lon, radius_km: radiusKm, on: date } : null),
    [h, lat, lon, radiusKm, date],
  )
  const outlook = useSelectionQuery(outlookKey, askOutlook)

  // Weather is asked for by the month; the window can straddle two.
  const fromMonth = h ? dayToMonth(h.epoch, fromDay) : ''
  const toMonth = date.slice(0, 7)
  const weatherKey = useMemo(
    () => (h && lat !== null && lon !== null ? { lat, lon, radius_km: radiusKm, from: fromMonth, to: toMonth } : null),
    [h, lat, lon, radiusKm, fromMonth, toMonth],
  )
  const months = useSelectionQuery<NonNullable<typeof weatherKey>, WeatherResponse>(weatherKey, askWeather)
  const weather = useMemo<QueryState<WeatherDay[]>>(() => {
    if (months.status !== 'ready' || !h) return months as QueryState<WeatherDay[]>
    const byDate = new Map(months.data.days.map((day) => [day.date, day]))
    const days: WeatherDay[] = []
    for (let day = fromDay; day <= asOfDay; day++) {
      const key = dayToDate(h.epoch, day)
      days.push(byDate.get(key) ?? { date: key, precip_mm: null, temp_max_c: null, wind_ms: null, humidity_pct: null })
    }
    return { status: 'ready', data: days }
  }, [months, h, fromDay, asOfDay])

  if (!h || !board) return null
  return { asOfDay, latest: asOfDay === h.maxDay, fromDay, board, cells, areas, year, outlook, weather }
}
