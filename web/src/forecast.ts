// The forecast seam. Nothing here forecasts anything.
//
// A forecast would be asked about a view - a place, a radius, a period, a mode - which is
// the same object a shared link carries (view.ts). What it would answer is not decided:
// the backend owner has to agree a shape first, so none is invented here. Until then
// every answer is "not available", the panel slot draws nothing, and the layer id below
// is reserved but no layer is made.
//
// Whatever lands here later: it is a likelihood for a place over a period, and the page
// must use the server's own label for it. Where a fire will spread needs wind, terrain,
// fuel and a validated model; a wrong one shown to responders is worse than none.

import type { View } from './view'

export type Forecast =
  | { available: false; reason: string }
  /** `answer` is deliberately untyped until the endpoint is agreed. */
  | { available: true; label: string; answer: unknown }

/** The id a forecast layer on the map would take. Reserved; nothing draws with it yet. */
export const FORECAST_LAYER_ID = 'forecast'

export const NO_FORECAST: Forecast = {
  available: false,
  reason: 'No forecast is available: the server does not offer one yet.',
}

export type ForecastRequest = View
