import { useEffect, useMemo, useRef } from 'react'
import { dateToDay, dayToDate, formatDate } from '../../lib/days'
import { count } from '../../lib/format'
import { WINDOW_DAYS } from '../../lib/situation'
import type { HotspotArrays } from '../../types'

export interface DayStripProps {
  hotspots: HotspotArrays
  asOfDay: number
  /** The chosen day's year: a count per day from `first`, as far as the record reaches. */
  year: { first: number; counts: number[]; days: number }
  /** Whether the counts are for the chosen circle or the whole region. */
  local: boolean
  /** Detections the map is drawing. */
  shown: number
  onDay: (date: string | null) => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The day control, where the record view has its time line: the chosen day, a step back
 * and forward, a jump to the latest day, and the year as a bar per day to click or drag
 * along. The map and the panel show the seven days up to the chosen day.
 */
export function DayStrip({ hotspots, asOfDay, year, local, shown, onDay }: DayStripProps) {
  const { epoch, minDay, maxDay } = hotspots
  const bar = useRef<HTMLDivElement>(null)
  const plot = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const { first, counts, days } = year
  const date = dayToDate(epoch, asOfDay)
  const yearNumber = Number(date.slice(0, 4))
  const latest = asOfDay === maxDay

  // The key and the map's controls sit above this bar, so its real height is published.
  useEffect(() => {
    const element = bar.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--timebar-h', `${element.offsetHeight}px`)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const go = (day: number) => {
    const held = Math.min(maxDay, Math.max(minDay, day))
    onDay(held === maxDay ? null : dayToDate(epoch, held))
  }

  // Square-root heights, so a quiet week is still visible beside a peak a thousand times it.
  const top = Math.max(1, ...counts)
  const paths = useMemo(() => {
    const all: string[] = []
    counts.forEach((n, i) => {
      if (n > 0) all.push(`M${i} 100V${(100 - Math.max(5, Math.sqrt(n / top) * 100)).toFixed(1)}H${i + 1}V100Z`)
    })
    return all.join('')
  }, [counts, top])

  const months = useMemo(() => MONTHS.map((name, m) => ({
    name,
    at: ((dateToDay(epoch, `${yearNumber}-${String(m + 1).padStart(2, '0')}-01`) - first) / days) * 100,
  })), [epoch, yearNumber, first, days])

  const at = (day: number) => ((day - first) / days) * 100
  const windowFrom = Math.max(first, asOfDay - (WINDOW_DAYS - 1))
  const recorded = Math.min(days, maxDay - first + 1)

  const pointerDay = (clientX: number) => {
    const box = plot.current!.getBoundingClientRect()
    return first + Math.min(days - 1, Math.max(0, Math.floor(((clientX - box.left) / box.width) * days)))
  }

  /** The same month and day in another year, or the nearest day the record holds. */
  const stepYear = (by: number) => {
    const target = `${yearNumber + by}${date.slice(4)}`
    // 29 February has no twin in most years; a day earlier is close enough.
    go(dateToDay(epoch, target.endsWith('02-29') ? `${yearNumber + by}-02-28` : target))
  }

  const onKey = (event: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageDown: -7, PageUp: 7 }
    if (event.key in step) go(asOfDay + step[event.key])
    else if (event.key === 'Home') go(first)
    else if (event.key === 'End') go(first + days - 1)
    else return
    event.preventDefault()
  }

  const firstYear = Number(dayToDate(epoch, minDay).slice(0, 4))
  const lastYear = Number(dayToDate(epoch, maxDay).slice(0, 4))

  return (
    <div className="timedock daydock" ref={bar}>
      <div className="td-main">
        <div className="day-step" role="group" aria-label="Chosen day">
          <button type="button" className="play" onClick={() => go(asOfDay - 1)} disabled={asOfDay <= minDay} aria-label="Previous day" title="Previous day">‹</button>
          <button type="button" className="play" onClick={() => go(asOfDay + 1)} disabled={latest} aria-label="Next day" title="Next day">›</button>
        </div>

        <div className="day-readout">
          <label>
            <strong>{formatDate(date)}</strong>
            <input
              type="date" value={date} min={dayToDate(epoch, minDay)} max={dayToDate(epoch, maxDay)} required
              aria-label="Choose a day" title="Choose a day"
              onChange={(event) => { if (event.target.value) go(dateToDay(epoch, event.target.value)) }}
            />
          </label>
          <span><b>{count(shown)}</b> on the map · last 7 days</span>
        </div>

        <div className="day-track">
          <div
            className="day-plot" ref={plot}
            role="slider" tabIndex={0}
            aria-label="Chosen day" aria-orientation="horizontal"
            aria-valuemin={minDay} aria-valuemax={maxDay} aria-valuenow={asOfDay}
            aria-valuetext={formatDate(date)}
            title={`Detections per day, ${local ? 'in the chosen area' : 'whole region'}. Click or drag to choose a day.`}
            onKeyDown={onKey}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              dragging.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              go(pointerDay(event.clientX))
            }}
            onPointerMove={(event) => { if (dragging.current) go(pointerDay(event.clientX)) }}
            onPointerUp={() => { dragging.current = false }}
            onPointerCancel={() => { dragging.current = false }}
          >
            <svg className="day-bars" viewBox={`0 0 ${days} 100`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <clipPath id="day-window">
                  <rect x={windowFrom - first} y="0" width={asOfDay - windowFrom + 1} height="100" />
                </clipPath>
              </defs>
              <path className="day-bar" d={paths} />
              <path className="day-bar is-window" d={paths} clipPath="url(#day-window)" />
            </svg>
            {recorded < days && <div className="day-after" style={{ left: `${(recorded / days) * 100}%` }} title="After the record" />}
            <div className="day-band" style={{ left: `${at(windowFrom)}%`, width: `${at(asOfDay + 1) - at(windowFrom)}%` }} />
            <div className="day-head" style={{ left: `${at(asOfDay + 1)}%` }} />
          </div>
          <div className="day-months" aria-hidden="true">
            {months.map(({ name, at: left }) => <span key={name} style={{ left: `${left}%` }}>{name}</span>)}
          </div>
        </div>

        <div className="seg day-year" role="group" aria-label="Year">
          <button type="button" onClick={() => stepYear(-1)} disabled={yearNumber <= firstYear} aria-label="Previous year" title="Same date, a year earlier">‹</button>
          <span>{yearNumber}</span>
          <button type="button" onClick={() => stepYear(1)} disabled={yearNumber >= lastYear} aria-label="Next year" title="Same date, a year later">›</button>
        </div>

        <button type="button" onClick={() => onDay(null)} disabled={latest} title="Go to the last day of the record">Latest</button>
      </div>
    </div>
  )
}
