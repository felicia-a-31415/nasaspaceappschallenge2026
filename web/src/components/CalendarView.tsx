import { useMemo, useRef, useState } from 'react'

import { buildCalendar, monthGrid, monthSlots, MONTH_LABELS, slotDate, SLOTS } from '../lib/calendar'
import type { MonthCell } from '../lib/calendar'
import { formatDate, SWITCH_MONTH } from '../lib/days'
import { coordinates, megawatts, plural } from '../lib/format'
import { Z_COLOURS, zClass } from '../map/anomaly'
import { cssColour, rampColour } from '../map/colourRamp'
import type { HotspotArrays, Selection } from '../types'
import type { Encoding } from './MapControls'

export interface CalendarViewProps {
  hotspots: HotspotArrays
  /** The area of interest, or null for the whole region. */
  selection: Selection | null
  placeName: string | null
  encoding: Encoding
  /** The chosen period, YYYY-MM. */
  from: string
  to: string
  /** Outline the chosen period. Off when the period is the whole record. */
  highlight: boolean
  /** A month was clicked: show it on the map. */
  onPick: (date: string) => void
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SWITCH_YEAR = Number(SWITCH_MONTH.slice(0, 4))

/** Fire power runs over six orders of magnitude, so its colour scale is logarithmic. */
function frpFraction(value: number, max: number): number {
  return max > 0 ? 0.1 + 0.9 * (Math.log10(1 + value) / Math.log10(1 + max)) : 0
}

function times(ratio: number): string {
  if (ratio >= 100) return 'over 100×'
  return `${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}×`
}

/** One sentence placing the month against the same month in other years. */
function compared(cell: MonthCell): string | null {
  if (cell.usual === null) return null
  const name = MONTH_NAMES[cell.month - 1]
  if (cell.usual < 0.5) return cell.cellDays > 0 ? `Fire is rare here in ${name}.` : null
  if (cell.cellDays === 0) return `Usually there is some fire in ${name}.`
  const ratio = cell.cellDays / cell.usual
  if (ratio >= 0.8 && ratio <= 1.25) return `About usual for ${name}.`
  return ratio > 1 ? `${times(ratio)} the usual ${name}.` : `Less than usual for ${name}.`
}

/**
 * When fire burned in the area: one row per year, newest first, one square per month.
 * A square is brighter the more fire the month held (or, in the anomaly encoding, the
 * further it sat above the same month in other years). Hovering a square says what it
 * holds in words; clicking it opens that month on the map.
 */
export function CalendarView({ hotspots, selection, placeName, encoding, from, to, highlight, onPick }: CalendarViewProps) {
  const lat = selection?.lat ?? null
  const lon = selection?.lon ?? null
  const radius = selection?.radius_km ?? null
  const calendar = useMemo(
    () => buildCalendar(hotspots, lat !== null && lon !== null && radius !== null ? { lat, lon, radius_km: radius } : null),
    [hotspots, lat, lon, radius],
  )
  const grid = useMemo(() => monthGrid(calendar), [calendar])

  const frame = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ at: number; left: number; top: number; right: number; bottom: number } | null>(null)

  const point = (at: number, element: HTMLElement) => {
    const box = frame.current!.getBoundingClientRect()
    const cell = element.getBoundingClientRect()
    setHover({
      at,
      left: cell.left - box.left,
      top: cell.top - box.top,
      right: box.right - cell.right,
      bottom: box.bottom - cell.bottom,
    })
  }

  const colour = (cell: MonthCell): string | undefined => {
    if (encoding === 'frp') return cell.frp > 0 ? cssColour(rampColour(frpFraction(cell.frp, grid.maxFrp))) : undefined
    // A month with no fire and no expectation of any is empty, not "usual".
    if (cell.z === null || (cell.cellDays === 0 && (cell.usual ?? 0) < 0.5)) return undefined
    return cssColour(Z_COLOURS[zClass(cell.z)])
  }

  // Newest year first: the recent seasons are the ones being asked about.
  const rows = grid.years.map((_, row) => row).reverse()
  const topYear = Math.max(1, ...grid.yearFireDays)
  const area = selection
    ? `${placeName ?? coordinates(selection.lat, selection.lon)}, within ${selection.radius_km} km`
    : 'All of Quebec'
  const hovered = hover ? grid.cells[hover.at] : null
  const eraRow = grid.years.includes(SWITCH_YEAR) && grid.years[0] < SWITCH_YEAR

  return (
    <section className="calendar" aria-label="Fire calendar">
      <header className="cal-head">
        <div>
          <h2>When fire burned</h2>
          <p>{area}</p>
        </div>
        <p className="cal-how">
          Each square is one month.{' '}
          {encoding === 'frp' ? 'Brighter means more fire.' : 'Colour compares the month with the same month in other years.'}{' '}
          Click a month to see it on the map.
        </p>
      </header>

      <div className="cal-frame" ref={frame} onMouseLeave={() => setHover(null)}>
        <div className="cal-grid cal-months" aria-hidden="true">
          <span />
          {MONTH_LABELS.map((label) => <span key={label}>{label}</span>)}
          <span className="cal-total-head">Days with fire</span>
        </div>

        <div className="cal-rows">
          {rows.map((row) => {
            const year = grid.years[row]
            return (
              <div key={year} className="cal-row-wrap">
                <div className="cal-grid cal-row">
                  <span className="cal-year">{year}</span>
                  {grid.cells.slice(row * 12, row * 12 + 12).map((cell, m) => {
                    const at = row * 12 + m
                    const month = `${year}-${String(cell.month).padStart(2, '0')}`
                    if (!cell.exists) return <i key={m} className="cal-cell is-none" />
                    const chosen = highlight && month >= from && month <= to
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`cal-cell ${chosen ? 'is-chosen' : ''} ${hover?.at === at ? 'is-hover' : ''}`}
                        style={{ background: colour(cell) }}
                        aria-label={`${MONTH_NAMES[m]} ${year}: ${cell.fireDays ? plural(cell.fireDays, 'day') + ' with fire' : 'no fire detected'}`}
                        onMouseEnter={(event) => point(at, event.currentTarget)}
                        onFocus={(event) => point(at, event.currentTarget)}
                        onBlur={() => setHover(null)}
                        onClick={() => onPick(`${month}-01`)}
                      />
                    )
                  })}
                  <span className="cal-total">
                    <i style={{ width: `${(grid.yearFireDays[row] / topYear) * 100}%` }} />
                    <b>{grid.yearFireDays[row]}</b>
                  </span>
                </div>
                {eraRow && year === SWITCH_YEAR && (
                  <p className="cal-era">
                    <span>Newer satellite sensor from 2012. Earlier years were seen by an older one that picks up fewer fires.</span>
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {hover && hovered && (
          <div
            className="cal-tip"
            role="status"
            style={{
              ...(hovered.month > 8 ? { right: hover.right } : { left: hover.left }),
              ...(hover.top > hover.bottom ? { bottom: hover.bottom + 30 } : { top: hover.top + 30 }),
            }}
          >
            <strong>{MONTH_NAMES[hovered.month - 1]} {hovered.year}</strong>
            {hovered.fireDays === 0
              ? <p>No fire detected.</p>
              : (
                <>
                  <Days calendar={calendar} row={grid.years.indexOf(hovered.year)} month={hovered.month} />
                  <dl>
                    <div><dt>Days with fire</dt><dd>{hovered.fireDays}</dd></div>
                    <div><dt>Busiest day</dt><dd>{formatDate(slotDate(hovered.year, hovered.peakSlot) ?? '').replace(/ \d{4}$/, '')}</dd></div>
                    <div><dt>Total fire power</dt><dd>{megawatts(hovered.frp)}</dd></div>
                  </dl>
                </>
              )}
            {compared(hovered) && <p>{compared(hovered)}</p>}
            <p className="cal-tip-hint">Click to open on the map</p>
          </div>
        )}
      </div>

      <footer className="cal-key">
        {encoding === 'frp'
          ? (
            <>
              <span>Less fire</span>
              <i className="cal-ramp" style={{ background: `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, i) => cssColour(rampColour(0.1 + (0.9 * i) / 8))).join(', ')})` }} />
              <span>More fire</span>
            </>
          )
          : (
            <>
              <span>Below usual</span>
              <span className="cal-steps">{Z_COLOURS.map((c, i) => <i key={i} style={{ background: cssColour(c) }} />)}</span>
              <span>Far above usual</span>
            </>
          )}
        <span className="cal-key-item"><i className="cal-cell" />No fire</span>
        {highlight && <span className="cal-key-item"><i className="cal-cell is-chosen" />Selected period</span>}
      </footer>
    </section>
  )
}

/** The month's days as small bars, so the tip shows when in the month it burned. */
function Days({ calendar, row, month }: { calendar: ReturnType<typeof buildCalendar>; row: number; month: number }) {
  const [a, b] = monthSlots(month)
  const days: number[] = []
  for (let slot = a; slot < b; slot++) {
    const v = calendar.cells[row * SLOTS + slot]
    if (!Number.isNaN(v)) days.push(v)
  }
  const top = Math.max(1, ...days)
  return (
    <div className="cal-days" aria-hidden="true">
      {days.map((v, i) => <i key={i} className={v ? '' : 'is-zero'} style={{ height: v ? `${Math.max(12, (v / top) * 100)}%` : undefined }} />)}
    </div>
  )
}
