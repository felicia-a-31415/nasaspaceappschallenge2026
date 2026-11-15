import { formatDate, formatMonth } from '../lib/days'
import type { QueryState } from '../hooks/useSelectionQuery'
import type { WeatherDay, WeatherResponse } from '../types'

/** Beyond this many days the strip shows one column per month instead of per day. */
const DAILY_LIMIT = 95

interface Period {
  label: string
  rain: number | null
  temp: number | null
  wind: number | null
  humidity: number | null
}

function mean(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null)
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null
}

function total(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null)
  return real.length ? real.reduce((a, b) => a + b, 0) : null
}

function groupByMonth(days: WeatherDay[]): Period[] {
  const months = new Map<string, WeatherDay[]>()
  for (const day of days) {
    const key = day.date.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), day])
  }
  return [...months.entries()].map(([month, rows]) => ({
    label: formatMonth(month),
    rain: total(rows.map((r) => r.precip_mm)),
    temp: mean(rows.map((r) => r.temp_max_c)),
    wind: mean(rows.map((r) => r.wind_ms)),
    humidity: mean(rows.map((r) => r.humidity_pct)),
  }))
}

/** A row of bars, one per period, with the biggest value written out. */
function Row({ title, unit, periods, pick, decimals = 0 }: {
  title: string
  unit: string
  periods: Period[]
  pick: (p: Period) => number | null
  decimals?: number
}) {
  const values = periods.map(pick)
  const top = Math.max(1, ...values.map((v) => v ?? 0))
  return (
    <div className="weather-row">
      <span className="weather-name">{title}</span>
      <span className="weather-bars" aria-hidden="true">
        {periods.map((period, i) => (
          <span
            key={period.label}
            className={values[i] === null ? 'weather-bar is-missing' : 'weather-bar'}
            style={{ height: `${values[i] === null ? 100 : Math.max(6, ((values[i] ?? 0) / top) * 100)}%` }}
            title={`${period.label}: ${values[i] === null ? 'no reading' : values[i]?.toFixed(decimals)} ${unit}`}
          />
        ))}
      </span>
      <span className="weather-top">{top.toFixed(decimals)} {unit}</span>
    </div>
  )
}

export function WeatherStrip({ state }: { state: QueryState<WeatherResponse> }) {
  if (state.status === 'error') {
    return <section className="weather"><h3>Weather</h3><p className="warn-box">{state.detail}</p></section>
  }
  if (state.status !== 'ready') {
    return <section className="weather"><h3>Weather</h3><p className="muted small">Asking NASA…</p></section>
  }
  const { days, source } = state.data
  if (!days.length) {
    return <section className="weather"><h3>Weather</h3><p className="muted small">No weather readings for this period.</p></section>
  }

  const periods: Period[] = days.length > DAILY_LIMIT
    ? groupByMonth(days)
    : days.map((day) => ({
      label: formatDate(day.date),
      rain: day.precip_mm,
      temp: day.temp_max_c,
      wind: day.wind_ms,
      humidity: day.humidity_pct,
    }))

  return (
    <section className="weather">
      <h3>Weather at this point</h3>
      <p className="small muted weather-span">
        {periods[0].label} to {periods[periods.length - 1].label}
        {days.length > DAILY_LIMIT ? ', by month' : ', by day'}
      </p>
      <Row title="Rain" unit="mm" periods={periods} pick={(p) => p.rain} decimals={periods.length > 1 ? 0 : 1} />
      <Row title="Hottest" unit="°C" periods={periods} pick={(p) => p.temp} decimals={1} />
      <Row title="Wind" unit="m/s" periods={periods} pick={(p) => p.wind} decimals={1} />
      <Row title="Humidity" unit="%" periods={periods} pick={(p) => p.humidity} />
      <p className="small muted">Weather: {source}. The tallest bar in each row is written beside it.</p>
    </section>
  )
}
