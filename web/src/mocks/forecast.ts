// The forecast's mock twin. The spread forecast is a trained model that lives on the
// server; the mocks hold no copy of it and invent no chances, so they say so.

import type { Forecast, ForecastRequest } from '../forecast'

export async function forecast(_view: ForecastRequest, _day: string): Promise<Forecast> {
  return { available: false, reason: 'The mock data carries no spread model. Run against the real server.' }
}
