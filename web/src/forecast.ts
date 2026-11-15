// The forecast seam: the server's experimental spread forecast, cut down to what the page
// may say.
//
// GET /api/spread scores every 2 km square near a fire. The page keeps only the answer
// for the chosen point - the chance that fire is seen within about 2 km of it by each of
// the coming days - and the server's own reasons. The per-square chances and the burning
// squares are dropped here, on purpose, so nothing downstream can draw them: it is a
// likelihood for a place over a period, under the server's own label, and never a picture
// of where a fire will spread. A wrong one shown to responders is worse than none.

import type { View } from './view'

/** The chosen point, as the server answers for it. */
export interface ForecastPlace {
  /** Distance to the nearest square burning on the as-of day, inside the circle. */
  nearest_fire_km: number
  /** Compass direction of that fire from the point, in the server's words ("north-west"). */
  nearest_fire_from: string
  /** Chance fire is seen within about 2 km of the point by day 1, 2, ... Never falls. */
  p: number[]
  /** First day `p` reaches the warning threshold, or null if it never does. */
  warning_by_day: number | null
}

export type Forecast =
  | { available: false; reason: string }
  | {
    available: true
    /** The server's own label. The page shows it as it is. */
    label: string
    /** The day the forecast starts from, YYYY-MM-DD. */
    as_of: string
    days_ahead: number
    /** A chance at or above this counts as a warning (0.10 is 1 in 10). */
    threshold: number
    /** Null when no fire was burning inside the circle that day. */
    place: ForecastPlace | null
    reasons: string[]
  }

/** The id a forecast layer on the map would take. Reserved; nothing draws with it. */
export const FORECAST_LAYER_ID = 'forecast'

const NO_FORECAST_REASON = 'No forecast is available here.'

export const NO_FORECAST: Forecast = { available: false, reason: NO_FORECAST_REASON }

export type ForecastRequest = View

/** The forecast needs VIIRS, whose first full day this is. */
export const FORECAST_FIRST_DAY = '2012-01-20'
export const FORECAST_DAYS = 3

/**
 * The day a forecast may be asked for, or null when there is none to ask about. Only the
 * operational view has an as-of day; left unset it is the last day of the record. A day
 * the endpoint would refuse (before VIIRS, or after the record ends) is never sent.
 */
export function forecastDay(view: View, dataThrough: string | null | undefined): string | null {
  if (view.mode !== 'shift' || view.lat === null || view.lon === null || !dataThrough) return null
  const day = view.on ?? dataThrough
  return day >= FORECAST_FIRST_DAY && day <= dataThrough ? day : null
}

/** What /api/spread sends. Only the fields the page reads are named. */
export interface SpreadResponse {
  label?: string
  detail?: string | null
  as_of?: string
  days_ahead?: number
  threshold?: number
  place?: ForecastPlace | null
  reasons?: string[]
}

/** The server's answer as the page's forecast. A region with no data yet is "not available". */
export function fromSpread(body: SpreadResponse): Forecast {
  if (!body.label || !body.as_of || !Array.isArray(body.reasons)) {
    return { available: false, reason: body.detail || NO_FORECAST_REASON }
  }
  return {
    available: true,
    label: body.label,
    as_of: body.as_of,
    days_ahead: body.days_ahead ?? body.place?.p.length ?? 0,
    threshold: body.threshold ?? 0.1,
    place: body.place ?? null,
    reasons: body.reasons,
  }
}

/** A chance in words: whole percent, and never a bare "0%" for something merely unlikely. */
export function chanceText(p: number): string {
  if (p < 0.01) return 'under 1%'
  return `${Math.round(p * 100)}%`
}
