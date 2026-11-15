import { useEffect, useState } from 'react'
import { getForecast } from '../api'
import { chanceText, forecastDay } from '../forecast'
import type { Forecast } from '../forecast'
import { dateToDay, dayToDate, formatDate } from '../lib/days'
import type { View } from '../view'

/** What the model cannot know. Shown with every answer, never dropped. */
const LIMITS = 'Learned from past Quebec fires. Doesn\'t know about firefighting, lakes, '
  + 'roads or fuel type. Satellites miss fire under thick smoke.'

type Asked =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; forecast: Forecast }

/** "2023-06-03" and 2 give "5 June". */
function dayAfter(asOf: string, days: number): string {
  return formatDate(dayToDate(asOf, dateToDay(asOf, asOf) + days)).replace(/ \d{4}$/, '')
}

/**
 * The server's experimental spread forecast, as words in the panel: the chance that fire
 * is seen within about 2 km of the chosen point over the coming days, the nearest fire,
 * and the server's own reasons. It is a likelihood for a place over a period. Nothing is
 * drawn on the map for it, and it is never worded as where a fire will spread.
 *
 * It asks only in the operational view, for an as-of day the endpoint accepts; otherwise
 * it draws nothing.
 */
export function ForecastSlot({ view, dataThrough }: { view: View; dataThrough?: string }) {
  const [asked, setAsked] = useState<Asked | null>(null)
  const day = forecastDay(view, dataThrough)
  const { lat, lon, radius_km: radiusKm } = view
  const key = day ? `${lat},${lon},${radiusKm},${day}` : null

  useEffect(() => {
    if (!key || !day) return
    const controller = new AbortController()
    let live = true
    setAsked({ key, status: 'loading' })
    getForecast(view, day, controller.signal)
      .then((forecast) => { if (live) setAsked({ key, status: 'ready', forecast }) })
      // A refusal or a failure is "no forecast": an experimental figure is never guessed at.
      .catch(() => { if (live) setAsked(null) })
    return () => {
      live = false
      controller.abort()
    }
    // The answer depends on the point, the circle and the day, not on the rest of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key || !asked || asked.key !== key) return null
  if (asked.status === 'loading') {
    return (
      <section className="forecast is-loading" aria-busy="true">
        <h3>Spread forecast <span className="kind kind-estimate">Experimental</span></h3>
        <p className="small muted">Running the model on that day's detections and weather…</p>
      </section>
    )
  }

  const { forecast } = asked
  if (!forecast.available) return null
  const { place, reasons, as_of: asOf, threshold } = forecast
  // No fire in the circle that day: the server's one sentence, or nothing.
  if (!place && !reasons.length) return null
  const odds = `1 in ${Math.round(1 / threshold)}`

  return (
    <section className="forecast">
      <h3>{forecast.label} <span className="kind kind-estimate">Experimental</span></h3>
      {place
        ? (
          <>
            <p className="forecast-lead">Chance of fire within 2 km of this point, from {formatDate(asOf)}</p>
            <dl className="forecast-days">
              {place.p.map((p, i) => (
                <div key={i} className={p >= threshold ? 'is-warning' : ''}>
                  <dt>{i === 0 ? 'Within 1 day' : `Within ${i + 1} days`}<span>by {dayAfter(asOf, i + 1)}</span></dt>
                  <dd>{chanceText(p)}</dd>
                </div>
              ))}
            </dl>
            <p className="small">
              {place.warning_by_day !== null
                ? `Warning level (${odds} or more) reached within ${place.warning_by_day} day${place.warning_by_day > 1 ? 's' : ''}.`
                : `Below the warning level (${odds}) for all ${place.p.length} days.`}
            </p>
            <p className="small">
              Nearest fire that day: {place.nearest_fire_km < 10 ? place.nearest_fire_km.toFixed(1) : Math.round(place.nearest_fire_km)} km
              to the {place.nearest_fire_from}.
            </p>
            {reasons.length > 0 && (
              <ul className="reasons small">
                {reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
          </>
        )
        : <p className="small note-box">{reasons[0]}</p>}
      <p className="small muted">{LIMITS}</p>
    </section>
  )
}
