import { useEffect, useState } from 'react'
import { getForecast } from '../api'
import type { Forecast } from '../forecast'
import type { View } from '../view'

/**
 * Where a forecast would sit in the panel. There is none today, so this draws nothing:
 * `getForecast` answers "not available" and the slot stays empty.
 *
 * When one exists it shows the server's own label and nothing more until the shape of
 * the answer is agreed with the backend owner. It will be a likelihood for a place over
 * a period. It must never be drawn or worded as where a fire will spread.
 */
export function ForecastSlot({ view }: { view: View }) {
  const [forecast, setForecast] = useState<Forecast | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    getForecast(view, controller.signal)
      .then((answer) => { if (live) setForecast(answer) })
      .catch(() => { if (live) setForecast(null) })
    return () => {
      live = false
      controller.abort()
    }
  }, [view])

  if (!forecast || !forecast.available) return null
  return (
    <section className="forecast">
      <h3>{forecast.label}</h3>
    </section>
  )
}
