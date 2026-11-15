// The forecast's mock twin. There is no server logic to mirror yet, so it says so.

import { NO_FORECAST } from '../forecast'
import type { Forecast, ForecastRequest } from '../forecast'

export async function forecast(_view: ForecastRequest): Promise<Forecast> {
  return NO_FORECAST
}
