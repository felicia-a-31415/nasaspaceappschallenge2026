// One function per endpoint, each with a mock twin chosen by VITE_USE_MOCKS.
// Nothing else in the app may call fetch.

import { USE_MOCKS } from './env'
import { NO_FORECAST } from './forecast'
import type { Forecast, ForecastRequest } from './forecast'
import * as mock from './mocks'
import { forecast as mockForecast } from './mocks/forecast'
import type {
  AboutResponse, ActivityResponse, HotspotsResponse, OutlookResponse, Selection, StatsResponse,
  TopAreasResponse, WeatherResponse,
} from './types'

/** An error whose message is the server's own `detail` sentence, written for users. */
export class ApiRequestError extends Error {
  readonly status: number
  /** The server's own sentence, ready to show. */
  readonly detail: string
  constructor(detail: string, status: number) {
    super(detail)
    this.name = 'ApiRequestError'
    this.status = status
    this.detail = detail
  }
}

export function selectionQuery(selection: Selection, extra: Record<string, string | number> = {}): string {
  const q = new URLSearchParams({
    lat: String(selection.lat),
    lon: String(selection.lon),
    radius_km: String(selection.radius_km),
  })
  if (selection.from) q.set('from', selection.from)
  if (selection.to) q.set('to', selection.to)
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v))
  return q.toString()
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (!res.ok) {
    let detail = `The server could not answer (${res.status}).`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      // Not a JSON error body; keep the plain sentence above.
    }
    throw new ApiRequestError(detail, res.status)
  }
  return res.json() as Promise<T>
}

// --- live endpoints --------------------------------------------------------

export function getAbout(signal?: AbortSignal): Promise<AboutResponse> {
  return USE_MOCKS ? mock.about() : get('/api/about', signal)
}

export function getActivity(selection: Selection, signal?: AbortSignal): Promise<ActivityResponse> {
  return USE_MOCKS
    ? mock.activity(selection)
    : get(`/api/activity?${selectionQuery(selection)}`, signal)
}

/** The three ready-made charts explaining the correction. */
export function chartUrl(name: 'before' | 'after' | 'validation'): string {
  return USE_MOCKS ? `/mock/${name}.png` : `/api/charts/${name}.png`
}

// --- planned endpoints -----------------------------------------------------

export function getHotspots(signal?: AbortSignal): Promise<HotspotsResponse> {
  return USE_MOCKS
    ? get('/mock/hotspots.json', signal)
    : get('/api/hotspots?region=quebec', signal)
}

export function getStats(selection: Selection, signal?: AbortSignal): Promise<StatsResponse> {
  return USE_MOCKS
    ? mock.stats(selection)
    : get(`/api/stats?${selectionQuery(selection)}`, signal)
}

export function getTopAreas(
  range: { from?: string; to?: string; limit?: number },
  signal?: AbortSignal,
): Promise<TopAreasResponse> {
  if (USE_MOCKS) return mock.topAreas(range)
  const q = new URLSearchParams({ limit: String(range.limit ?? 10) })
  if (range.from) q.set('from', range.from)
  if (range.to) q.set('to', range.to)
  return get(`/api/top-areas?${q}`, signal)
}

export function getOutlook(selection: Selection, signal?: AbortSignal): Promise<OutlookResponse> {
  return USE_MOCKS
    ? mock.outlook(selection)
    : get(`/api/outlook?${selectionQuery(selection)}`, signal)
}

export function getWeather(selection: Selection, signal?: AbortSignal): Promise<WeatherResponse> {
  return USE_MOCKS
    ? mock.weather(selection)
    : get(`/api/weather?${selectionQuery(selection)}`, signal)
}

// --- reserved: a forecast --------------------------------------------------

/**
 * Not an endpoint yet. The server offers no forecast and its shape has not been agreed,
 * so this asks nothing over the network and reports that none is available. When the
 * backend owner adds one, this is the only function to change.
 */
export function getForecast(view: ForecastRequest, _signal?: AbortSignal): Promise<Forecast> {
  return USE_MOCKS ? mockForecast(view) : Promise.resolve(NO_FORECAST)
}

// --- downloads: plain links ------------------------------------------------

export function monthlyCsvUrl(selection: Selection): string {
  return `/api/download/monthly.csv?${selectionQuery(selection)}`
}

export function hotspotsCsvUrl(selection: Selection): string {
  return `/api/download/hotspots.csv?${selectionQuery(selection)}`
}
