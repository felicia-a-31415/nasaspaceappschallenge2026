import { useEffect, useState } from 'react'
import type { SituationState } from '../../hooks/useSituation'
import { dayToDate, formatDate } from '../../lib/days'
import { count, megawatts, plural, position } from '../../lib/format'
import { AGE_COLOURS, ageClass, CHART_DAYS, WINDOW_DAYS } from '../../lib/situation'
import type { ActiveCell, SeasonToDate, Situation, Tally } from '../../lib/situation'
import { cssColour } from '../../map/colourRamp'
import { nameNear } from '../../places'
import type { HotspotArrays, WeatherDay } from '../../types'
import type { View } from '../../view'
import { ForecastSlot } from '../ForecastSlot'
import { Outlook } from '../Outlook'

export interface OpsPanelProps {
  view: View
  hotspots: HotspotArrays
  state: SituationState
  placeName: string | null
  radii: number[]
  onRadius: (km: number) => void
  onPick: (lat: number, lon: number, name: string | null) => void
  onClear: () => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const short = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`

/**
 * The operational view's side of the sheet, read on one chosen day. Same sheet and same
 * styles as the record view; the order is what someone on duty asks first: how much fire
 * was seen here this week and how near, what the coming days look like, the weather that
 * led up to it, how the year compares, and where in the region fire is most active.
 */
export function OpsPanel({ view, hotspots, state, placeName, radii, onRadius, onPick, onClear }: OpsPanelProps) {
  const { board, cells } = state
  const { lat, lon, radius_km: radiusKm } = view
  const chosen = lat !== null && lon !== null

  return (
    <>
      {chosen
        ? (
          <header className="place">
            <h2>{placeName ?? position(lat, lon)}</h2>
            <p className="place-sub">{placeName ? `${position(lat, lon)} · ` : ''}within {radiusKm} km</p>
            <div className="ops-area">
              <div className="seg" role="group" aria-label="Radius of the area">
                {radii.map((km) => (
                  <button key={km} type="button" aria-pressed={km === radiusKm} onClick={() => onRadius(km)}>{km} km</button>
                ))}
              </div>
              <button type="button" className="link" onClick={onClear}>Show whole region</button>
            </div>
          </header>
        )
        : (
          <div className="prompt">
            <h2>Whole region</h2>
            <p className="muted">Click the map or search a place to look at one area.</p>
          </div>
        )}

      <Detections board={board} epoch={hotspots.epoch} chosen={chosen} />
      {/* The experimental spread forecast, in words, when the server has one for this day. */}
      <ForecastSlot view={view} dataThrough={hotspots.dataThrough} />
      {chosen && <OutlookBlock state={state} />}
      {chosen && <Weather state={state} />}
      {board.season && <Season season={board.season} date={board.date} />}
      <Cells cells={cells} onPick={onPick} />
      <p className="small muted">
        Satellite detections by date, with no time of day. Cloud and thick smoke hide fire.
        Not a fire perimeter.
      </p>
    </>
  )
}

function Figure({ label, tally }: { label: string; tally: Tally }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{count(tally.detections)}</dd>
      <dd className="sub">{tally.detections ? megawatts(tally.sumFrp) : 'none'}</dd>
    </div>
  )
}

function trend(board: Situation): string {
  const now = board.last7.detections
  const before = board.prior7.detections
  if (!now && !before) return 'No detections in the last 14 days.'
  if (!before) return 'New this week: none in the 7 days before.'
  if (!now) return `Down to none, from ${count(before)} in the 7 days before.`
  const change = (now - before) / before
  if (Math.abs(change) < 0.1) return `About the same as the 7 days before (${count(before)}).`
  return `${change > 0 ? 'Up' : 'Down'} from ${count(before)} in the 7 days before.`
}

function Detections({ board, epoch, chosen }: { board: Situation; epoch: string; chosen: boolean }) {
  const top = Math.max(1, ...board.daily)
  const first = board.asOf - (CHART_DAYS - 1)
  const near = board.nearest

  return (
    <section>
      <h3>Fire detections</h3>
      <dl className="ops-figures">
        <Figure label={short(board.date)} tally={board.day0} />
        <Figure label="Last 3 days" tally={board.last3} />
        <Figure label="Last 7 days" tally={board.last7} />
      </dl>
      <p className="small muted">{trend(board)}</p>

      <figure className="ops-daily">
        <div className="ops-daily-bars" role="img" aria-label={`Detections per day, ${CHART_DAYS} days to ${board.date}`}>
          {board.daily.map((n, i) => {
            const age = CHART_DAYS - 1 - i
            return (
              <i
                key={i}
                className={n ? '' : 'is-zero'}
                style={{
                  height: n ? `${Math.max(6, (n / top) * 100)}%` : undefined,
                  background: n && age < WINDOW_DAYS ? cssColour(AGE_COLOURS[ageClass(age)]) : undefined,
                }}
                title={`${dayToDate(epoch, first + i)}: ${count(n)}`}
              />
            )
          })}
        </div>
        <figcaption>
          <span>{short(dayToDate(epoch, first))}</span>
          <span>detections per day</span>
          <span>{short(board.date)}</span>
        </figcaption>
      </figure>

      <dl className="kv">
        {chosen && (
          <div>
            <dt>Nearest fire, last 7 days</dt>
            <dd>{near ? `${near.km < 10 ? near.km.toFixed(1) : Math.round(near.km)} km ${near.toward} · ${short(dayToDate(epoch, near.day))}` : 'none in region'}</dd>
          </div>
        )}
        <div><dt>Strongest, last 7 days</dt><dd>{board.last7.detections ? megawatts(board.last7.maxFrp) : 'n/a'}</dd></div>
        {board.lastSeen !== board.asOf && (
          <div>
            <dt>Last seen here</dt>
            <dd>{board.lastSeen === null ? 'not in 10 years' : formatDate(dayToDate(epoch, board.lastSeen))}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}

function Season({ season, date }: { season: SeasonToDate; date: string }) {
  const total = season.others.length + 1
  const ratio = season.ratio
  return (
    <section>
      <h3>This year so far</h3>
      {ratio !== null && (
        <p className="ops-ratio">
          <b>{ratio >= 100 ? 'Over 100×' : `${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}×`}</b>
          <span>a usual year by this date</span>
        </p>
      )}
      <div className="rank">
        <div className="rank-ticks" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => <i key={i} className={i + 1 === season.rank ? 'is-here' : ''} />)}
        </div>
        <p><b>{season.rank}</b> of {total} years, highest first</p>
      </div>
      <dl className="kv">
        <div><dt>1 Jan – {short(date)} {season.year}</dt><dd>{plural(season.detections, 'detection')}</dd></div>
        <div><dt>Usual by this date</dt><dd>{plural(season.median, 'detection')}</dd></div>
      </dl>
      <p className="small muted">Compared with other {season.sensor} years only.</p>
    </section>
  )
}

function OutlookBlock({ state }: { state: SituationState }) {
  const { outlook } = state
  if (outlook.status === 'error') {
    return <section><h3>Outlook, next 14 days</h3><p className="warn-box">{outlook.detail}</p></section>
  }
  if (outlook.status !== 'ready') {
    return (
      <section aria-busy="true">
        <h3>Outlook, next 14 days</h3>
        <div className="skeleton" role="status" aria-label="Computing the outlook"><i className="sk sk-block" style={{ height: 84 }} /></div>
      </section>
    )
  }
  if (!outlook.data.level && !outlook.data.reasons.length) {
    return (
      <section>
        <h3>Outlook, next 14 days</h3>
        <p className="note-box">{outlook.data.detail ?? 'No outlook for this area.'}</p>
      </section>
    )
  }
  return <Outlook data={outlook.data} />
}

const cell = (value: number | null, decimals = 0) => (value === null ? '–' : value.toFixed(decimals))

function Weather({ state }: { state: SituationState }) {
  const { weather } = state
  const title = <h3>Weather, last 7 days</h3>
  if (weather.status === 'error') return <section>{title}<p className="warn-box">{weather.detail}</p></section>
  if (weather.status !== 'ready') {
    return (
      <section aria-busy="true">
        {title}
        <div className="skeleton" role="status" aria-label="Retrieving weather"><i className="sk sk-block" style={{ height: 112 }} /></div>
      </section>
    )
  }
  const days = weather.data
  const rows: { name: string; read: (day: WeatherDay) => string }[] = [
    { name: 'High, °C', read: (d) => cell(d.temp_max_c) },
    { name: 'Humidity, %', read: (d) => cell(d.humidity_pct) },
    { name: 'Wind, km/h', read: (d) => cell(d.wind_ms === null ? null : d.wind_ms * 3.6) },
    { name: 'Rain, mm', read: (d) => cell(d.precip_mm, d.precip_mm !== null && d.precip_mm > 0 && d.precip_mm < 10 ? 1 : 0) },
  ]
  const missing = days.filter((d) => d.temp_max_c === null && d.humidity_pct === null && d.wind_ms === null && d.precip_mm === null).length

  return (
    <section>
      {title}
      <table className="ops-weather">
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">Reading</span></th>
            {days.map((d) => <th key={d.date} scope="col" title={formatDate(d.date)}>{Number(d.date.slice(8, 10))}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              {days.map((d) => <td key={d.date}>{row.read(d)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        Measured at the centre point, {short(days[0].date)} – {short(days[days.length - 1].date)}. Not a forecast.
        {missing > 0 && ` ${missing} ${missing === 1 ? 'day is' : 'days are'} not published yet.`}
      </p>
    </section>
  )
}

const coords = (c: { lat: number; lon: number }) => `${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`
/** How long the list must sit still before names are looked up, so dragging the day asks for none. */
const NAME_AFTER_MS = 700

function useNames(cells: ActiveCell[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      for (const c of cells) {
        void nameNear(c.lat, c.lon).then((name) => {
          if (live && name) setNames((now) => (now[coords(c)] === name ? now : { ...now, [coords(c)]: name }))
        })
      }
    }, NAME_AFTER_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [cells])
  return names
}

function Cells({ cells, onPick }: { cells: ActiveCell[]; onPick: OpsPanelProps['onPick'] }) {
  const names = useNames(cells)
  return (
    <section className="top-areas">
      <h3>Most active areas, last 7 days</h3>
      {cells.length === 0
        ? <p className="muted small">No detections in the region in these 7 days.</p>
        : (
          <>
            <ol className="area-list">
              {cells.map((c, i) => {
                const name = names[coords(c)]
                return (
                  <li key={coords(c)}>
                    <button type="button" onClick={() => onPick(c.lat, c.lon, name ?? null)} title="Look at this area">
                      <span className="rank">{i + 1}</span>
                      <span className="where">
                        <span className="where-name">{name ?? coords(c)}</span>
                        <span className="where-coords">
                          <i className="ops-dot" style={{ background: cssColour(AGE_COLOURS[ageClass(c.lastAge)]) }} />
                          {c.lastAge === 0 ? 'burning on the chosen day' : `last seen ${c.lastAge} ${c.lastAge === 1 ? 'day' : 'days'} before`}
                        </span>
                      </span>
                      <span className="amount">
                        {megawatts(c.sumFrp)}
                        <span className="small muted">{plural(c.detections, 'detection')}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <p className="small muted">10 km squares, ranked by total fire power. Numbered on the map; click one to look at it.</p>
          </>
        )}
    </section>
  )
}
