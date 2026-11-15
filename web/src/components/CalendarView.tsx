import { useEffect, useMemo, useRef, useState } from 'react'

import { buildCalendar, MONTH_LABELS, MONTH_STARTS, slotDate, slotOf, SLOTS, WINDOW_DAYS } from '../lib/calendar'
import { SWITCH_MONTH } from '../lib/days'
import { coordinates, count } from '../lib/format'
import { Z_COLOURS, Z_LABELS, zClass } from '../map/anomaly'
import { cssColour, rampColour } from '../map/colourRamp'
import type { HotspotArrays, Selection } from '../types'
import type { Encoding } from './MapControls'

export interface CalendarViewProps {
  hotspots: HotspotArrays
  /** The area of interest, or null for the whole region. */
  selection: Selection | null
  placeName: string | null
  encoding: Encoding
  /** The chosen period, YYYY-MM, outlined on the grid. */
  from: string
  to: string
  /** A day was clicked: show its month on the map. */
  onPick: (date: string) => void
}

const LEFT = 46
const TOP = 20
const RIGHT = 78
const EMPTY = '#12161a'
const INK = '#b6b3ac'
const DIM = '#8d8b85'
const FONT = '10.5px "IBM Plex Mono", ui-monospace, monospace'

/** ΣFRP runs over six orders of magnitude, so its colour scale is logarithmic. */
function frpFraction(value: number, max: number): number {
  return max > 0 ? Math.log10(1 + value) / Math.log10(1 + max) : 0
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`
}

/**
 * Year by day-of-year matrix of burning activity for the area of interest, MODIS and
 * VIIRS in one frame. Encoding A colours each day by ΣFRP; encoding B by the standardized
 * anomaly of active cells against the same sensor's other years.
 */
export function CalendarView({ hotspots, selection, placeName, encoding, from, to, onPick }: CalendarViewProps) {
  const lat = selection?.lat ?? null
  const lon = selection?.lon ?? null
  const radius = selection?.radius_km ?? null
  const calendar = useMemo(
    () => buildCalendar(hotspots, lat !== null && lon !== null && radius !== null ? { lat, lon, radius_km: radius } : null),
    [hotspots, lat, lon, radius],
  )

  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hover, setHover] = useState<{ row: number; slot: number } | null>(null)

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const rows = calendar.years.length
  const cellW = Math.max(1, (size.width - LEFT - RIGHT) / SLOTS)
  const cellH = Math.max(4, Math.min(26, (size.height - TOP - 4) / rows))

  useEffect(() => {
    const element = canvas.current
    if (!element || !size.width) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(size.width * ratio)
    element.height = Math.round(size.height * ratio)
    const ctx = element.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.font = FONT
    ctx.textBaseline = 'middle'

    const maxYear = Math.max(1, ...calendar.yearCells)
    for (let row = 0; row < rows; row++) {
      const y = TOP + row * cellH
      for (let slot = 0; slot < SLOTS; slot++) {
        const at = row * SLOTS + slot
        const cells = calendar.cells[at]
        if (Number.isNaN(cells)) continue
        let colour = EMPTY
        if (encoding === 'frp') {
          const frp = calendar.frp[at]
          if (frp > 0) colour = cssColour(rampColour(frpFraction(frp, calendar.maxFrp)))
        } else {
          const z = calendar.z[at]
          // A day with no fire and no expectation of any is empty, not "normal".
          if (!Number.isNaN(z) && (cells > 0 || calendar.mean[at] >= 0.5)) colour = cssColour(Z_COLOURS[zClass(z)])
        }
        ctx.fillStyle = colour
        ctx.fillRect(LEFT + slot * cellW, y, Math.ceil(cellW), cellH - 1)
      }
      ctx.fillStyle = INK
      ctx.textAlign = 'right'
      ctx.fillText(String(calendar.years[row]), LEFT - 8, y + cellH / 2)
      // Annual cell-days, as a bar and a figure.
      const x = LEFT + SLOTS * cellW + 8
      ctx.fillStyle = '#3a4048'
      ctx.fillRect(x, y + 2, (calendar.yearCells[row] / maxYear) * 22, Math.max(1, cellH - 5))
      ctx.fillStyle = DIM
      ctx.textAlign = 'left'
      ctx.fillText(count(calendar.yearCells[row]), x + 27, y + cellH / 2)
    }

    ctx.fillStyle = DIM
    ctx.textAlign = 'left'
    MONTH_STARTS.forEach((start, month) => {
      const x = LEFT + start * cellW
      ctx.fillStyle = 'rgba(236, 233, 226, 0.16)'
      if (month > 0) ctx.fillRect(Math.round(x) - 0.5, TOP - 4, 1, rows * cellH + 4)
      ctx.fillStyle = DIM
      ctx.fillText(MONTH_LABELS[month].toUpperCase(), x + 3, 8)
    })
    ctx.fillText('CELL-DAYS', LEFT + SLOTS * cellW + 8, 8)

    // The sensor transition: a step between the last MODIS day and the first VIIRS day.
    const [switchYear, switchMonth] = SWITCH_MONTH.split('-').map(Number)
    const switchRow = calendar.years.indexOf(switchYear)
    if (switchRow >= 0) {
      const x = LEFT + slotOf(switchMonth, 1) * cellW
      const y = TOP + switchRow * cellH
      ctx.strokeStyle = '#f0c36a'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(LEFT, y + cellH - 0.5)
      ctx.lineTo(x, y + cellH - 0.5)
      ctx.lineTo(x, y - 0.5)
      ctx.lineTo(LEFT + SLOTS * cellW, y - 0.5)
      ctx.stroke()
    }

    // The chosen period, outlined in every row it touches.
    const [fromYear, fromMonth] = from.split('-').map(Number)
    const [toYear, toMonth] = to.split('-').map(Number)
    ctx.strokeStyle = '#6cc0ff'
    ctx.lineWidth = 1.5
    for (let row = 0; row < rows; row++) {
      const year = calendar.years[row]
      if (year < fromYear || year > toYear) continue
      const a = year === fromYear ? MONTH_STARTS[fromMonth - 1] : 0
      const b = year === toYear ? (toMonth === 12 ? SLOTS : MONTH_STARTS[toMonth]) : SLOTS
      ctx.strokeRect(LEFT + a * cellW, TOP + row * cellH - 0.5, (b - a) * cellW, cellH)
    }

    if (hover) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.strokeRect(LEFT + hover.slot * cellW - 0.5, TOP + hover.row * cellH - 0.5, Math.max(3, cellW) + 1, cellH)
    }
  }, [calendar, encoding, size, rows, cellW, cellH, from, to, hover])

  const locate = (event: React.MouseEvent) => {
    const box = canvas.current!.getBoundingClientRect()
    const slot = Math.floor((event.clientX - box.left - LEFT) / cellW)
    const row = Math.floor((event.clientY - box.top - TOP) / cellH)
    if (slot < 0 || slot >= SLOTS || row < 0 || row >= rows) return null
    return Number.isNaN(calendar.cells[row * SLOTS + slot]) ? null : { row, slot }
  }

  const at = hover ? hover.row * SLOTS + hover.slot : -1
  const hoverDate = hover ? slotDate(calendar.years[hover.row], hover.slot) : null
  const area = selection
    ? `${placeName ?? coordinates(selection.lat, selection.lon)} · R ${selection.radius_km} km`
    : 'Quebec, full extent'

  return (
    <section className="calendar" aria-label="Burning activity calendar">
      <header className="calendar-head">
        <div>
          <p className="eyebrow">Burning activity calendar · day of year × year</p>
          <h2>{area}</h2>
        </div>
        <dl className="kv calendar-meta">
          <div><dt>Encoding</dt><dd>{encoding === 'frp' ? 'ΣFRP per day, MW (log)' : 'z of active cells per day'}</dd></div>
          <div><dt>Grid</dt><dd>0.1° × 0.1° · 1 d</dd></div>
          {encoding === 'anomaly' && <div><dt>Baseline</dt><dd>same sensor, other years, DOY ±{WINDOW_DAYS} d</dd></div>}
        </dl>
      </header>

      <div className="calendar-frame" ref={frame}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Daily burning activity, ${calendar.years[0]} to ${calendar.years[rows - 1]}, one row per year`}
          style={{ width: size.width, height: size.height, cursor: hover ? 'pointer' : 'default' }}
          onMouseMove={(event) => {
            const next = locate(event)
            setHover((now) => (now?.row === next?.row && now?.slot === next?.slot ? now : next))
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(event) => {
            const cell = locate(event)
            const date = cell && slotDate(calendar.years[cell.row], cell.slot)
            if (date) onPick(date)
          }}
        />
      </div>

      <footer className="calendar-foot">
        <p className="calendar-probe" aria-live="off">
          {hover && hoverDate
            ? (
              <>
                <b>{hoverDate}</b>
                <span>{calendar.viirs[at] ? 'VIIRS' : 'MODIS'}</span>
                <span>active cells <b>{count(calendar.cells[at])}</b></span>
                <span>ΣFRP <b>{count(calendar.frp[at])} MW</b></span>
                {Number.isNaN(calendar.z[at])
                  ? <span>z n/a</span>
                  : (
                    <span>
                      z <b>{signed(calendar.z[at])}</b> (μ {calendar.mean[at].toFixed(1)}, σ {calendar.sd[at].toFixed(1)}, n {calendar.samples[at]})
                    </span>
                  )}
                <span className="calendar-hint">click: open month on map</span>
              </>
            )
            : <span className="calendar-hint">Hover a day to read it. Click to open its month on the map.</span>}
        </p>
        <div className="calendar-key">
          {encoding === 'frp'
            ? (
              <>
                <span>ΣFRP</span>
                <span>1</span>
                <i
                  className="calendar-ramp"
                  style={{ background: `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, i) => cssColour(rampColour(i / 8))).join(', ')})` }}
                />
                <span>{count(calendar.maxFrp)} MW</span>
              </>
            )
            : (
              <>
                <span>z</span>
                {Z_COLOURS.map((colour, i) => (
                  <span key={Z_LABELS[i]} className="calendar-class"><i style={{ background: cssColour(colour) }} />{Z_LABELS[i]}</span>
                ))}
              </>
            )}
          <span className="calendar-switch"><i />{SWITCH_MONTH} MODIS → VIIRS</span>
          <span className="calendar-period"><i />selected period</span>
        </div>
      </footer>
    </section>
  )
}
