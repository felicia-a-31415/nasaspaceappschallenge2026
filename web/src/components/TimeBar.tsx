import { useEffect, useMemo, useRef, useState } from 'react'
import { dayToMonth, formatDate, formatMonth, formatMonthShort, monthStartDay, SWITCH_MONTH } from '../lib/days'
import { monthlyIntensity, profileHeights } from '../lib/profile'
import { anchorFor, monthAt, nudge, spanFrom } from '../lib/rangeDrag'
import type { MonthSpan } from '../lib/rangeDrag'
import { dayShare } from '../hooks/useTimeline'
import type { Timeline } from '../hooks/useTimeline'
import { PLACE_SEARCH_CREDIT } from '../places'
import type { HotspotArrays } from '../types'
import { ExportVideo } from './ExportVideo'

const SPEEDS = [0.5, 1, 2]
const SWITCH_YEAR = Number(SWITCH_MONTH.slice(0, 4))

export interface TimeBarProps {
  timeline: Timeline
  hotspots: HotspotArrays
  /** The last day the record holds, YYYY-MM-DD. */
  dataThrough?: string
  /** The map's own canvas, for the video export. */
  getCanvas: () => HTMLCanvasElement | null
}

export function TimeBar({ timeline, hotspots, dataThrough, getCanvas }: TimeBarProps) {
  const { months, playing, head, monthRange, speed, run } = timeline
  const { epoch } = hotspots
  const bar = useRef<HTMLDivElement>(null)

  // The legend and the map's own controls sit directly above this bar, so its real
  // height is published as a variable rather than guessed at.
  useEffect(() => {
    const element = bar.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--timebar-h', `${element.offsetHeight}px`)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [months.length])

  if (!months.length) return null

  const [from, to] = monthRange
  const chosen = to - from + 1

  return (
    <div className="timedock" ref={bar}>
      <div className="td-main">
        <button
          type="button"
          className="play"
          onClick={() => (playing ? timeline.pause() : timeline.play())}
          aria-label={playing ? 'Pause' : 'Play through the chosen period'}
          title={playing ? 'Pause' : 'Play through the chosen period'}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </button>

        <div className="readout" aria-live={playing ? 'off' : 'polite'}>
          <strong>
            {playing
              ? formatMonth(dayToMonth(epoch, head))
              : from === to
                ? formatMonth(months[from])
                : `${formatMonthShort(months[from])} – ${formatMonthShort(months[to])}`}
          </strong>
          <span>
            {playing && run
              ? `Everything since ${formatMonthShort(dayToMonth(epoch, run.fromDay))}`
              : `${chosen} ${chosen === 1 ? 'month' : 'months'} · drag the ends`}
          </span>
        </div>

        <RangeTrack timeline={timeline} hotspots={hotspots} />

        <div className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => timeline.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>

        <ExportVideo timeline={timeline} epoch={epoch} getCanvas={getCanvas} />
      </div>

      <div className="td-foot">
        <p className="notice">
          <span aria-hidden="true">▲</span>
          <span>
            From February 2012 a sharper satellite camera took over and sees many more small
            fires. More dots after 2012 does not by itself mean more fire.
          </span>
        </p>
        <p className="credits">
          {dataThrough ? `Data to ${formatDate(dataThrough)} · ` : ''}
          Fire data: NASA FIRMS (MODIS, VIIRS) · Base map © OpenStreetMap contributors, © CARTO
          · {PLACE_SEARCH_CREDIT}
        </p>
      </div>
    </div>
  )
}

/**
 * The track: a thin rail with two round handles, a low shape of each month's fire
 * intensity above it to aim at, year ticks for scale, and the February 2012 line. It is
 * one pointer-driven control rather than two stacked sliders, so the handles can sit on
 * the same month, or pass through each other, and still be picked up. Each handle is its
 * own keyboard stop.
 */
function RangeTrack({ timeline, hotspots }: { timeline: Timeline; hotspots: HotspotArrays }) {
  const { months, recordLast, playing, head, monthRange, run } = timeline
  const { epoch } = hotspots
  const last = months.length - 1
  const [from, to] = monthRange

  const track = useRef<HTMLDivElement>(null)
  /** The plot is what the months are laid along; the track around it has padding. */
  const plot = useRef<HTMLDivElement>(null)
  const fromHandle = useRef<HTMLButtonElement>(null)
  const toHandle = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ anchor: number; offset: number } | { seek: true } | null>(null)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const element = plot.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const heights = useMemo(
    () => profileHeights(monthlyIntensity(hotspots, months), months),
    [hotspots, months],
  )
  const switchIndex = months.indexOf(SWITCH_MONTH)
  const share = (index: number) => (last > 0 ? (index / last) * 100 : 0)

  const shape = useMemo(() => {
    const older: string[] = []
    const newer: string[] = []
    heights.forEach((h, i) => {
      if (h <= 0) return
      const rect = `M${i - 0.5} 100V${(100 - h * 100).toFixed(1)}H${i + 0.5}V100Z`
      ;(switchIndex >= 0 && i < switchIndex ? older : newer).push(rect)
    })
    return { older: older.join(''), newer: newer.join('') }
  }, [heights, switchIndex])

  // Every January is a tick; how many carry a label depends on the room. The year the
  // camera changed is always named, and its neighbours make way for it.
  const years = useMemo(() => {
    const perYear = last > 0 ? (width / last) * 12 : 0
    const every = perYear >= 35 ? 1 : perYear >= 18 ? 2 : 5
    return months
      .map((month, index) => ({ month, index }))
      .filter(({ month }) => month.endsWith('-01'))
      .map(({ month, index }) => {
        const year = Number(month.slice(0, 4))
        const isSwitch = year === SWITCH_YEAR && switchIndex >= 0
        const crowded = !isSwitch && switchIndex >= 0 && Math.abs(year - SWITCH_YEAR) * perYear < 36
        return { year, index, isSwitch, labelled: isSwitch || (year % every === 0 && !crowded) }
      })
  }, [months, last, width, switchIndex])

  const pointerMonth = (clientX: number, offset = 0) => {
    const box = plot.current!.getBoundingClientRect()
    return monthAt(clientX - offset, box.left, box.width, last)
  }

  const apply = (anchor: number, at: number) => {
    timeline.setMonthRange(spanFrom(anchor, Math.min(at, recordLast)))
    // Keyboard focus follows the handle that is moving, including after it crosses.
    const moving = at < anchor ? fromHandle : at > anchor ? toHandle : null
    moving?.current?.focus({ preventScroll: true })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('.track-years')) return
    event.preventDefault()
    track.current!.setPointerCapture(event.pointerId)
    if (playing) {
      drag.current = { seek: true }
      timeline.seek(monthStartDay(epoch, months[pointerMonth(event.clientX)]))
      return
    }
    // A handle picked up off-centre should not jump to the pointer.
    const grabbed = (event.target as HTMLElement).closest<HTMLElement>('.handle')
    let offset = 0
    if (grabbed) {
      const box = grabbed.getBoundingClientRect()
      offset = event.clientX - (box.left + box.width / 2)
    }
    const at = Math.min(pointerMonth(event.clientX, offset), recordLast)
    const anchor = grabbed && from !== to
      ? (grabbed === fromHandle.current ? to : from)
      : anchorFor(monthRange, at)
    drag.current = { anchor, offset }
    setDragging(true)
    ;(anchor === to && from !== to ? fromHandle : toHandle).current?.focus({ preventScroll: true })
    apply(anchor, at)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    if ('seek' in state) {
      timeline.seek(monthStartDay(epoch, months[pointerMonth(event.clientX)]))
      return
    }
    apply(state.anchor, pointerMonth(event.clientX, state.offset))
  }

  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  const onKey = (handle: 'from' | 'to') => (event: React.KeyboardEvent) => {
    const next = nudge(monthRange, handle, event.key, recordLast)
    if (!next) return
    event.preventDefault()
    timeline.setMonthRange(next)
  }

  const pickYear = (year: number) => {
    const first = months.findIndex((m) => m.startsWith(`${year}-`))
    if (first < 0 || first > recordLast) return
    let end = first
    while (end + 1 <= recordLast && months[end + 1].startsWith(`${year}-`)) end++
    const span: MonthSpan = [first, end]
    if (playing) timeline.pause()
    timeline.setMonthRange(span)
  }

  // While playing the band is what is on the map: from the start of the run to the playhead.
  const headAt = dayShare(epoch, months, head) * 100
  const runAt = run ? dayShare(epoch, months, run.fromDay) * 100 : 0
  const band = playing
    ? { left: `${runAt}%`, width: `${Math.max(0, headAt - runAt)}%` }
    : { left: `${share(from)}%`, width: `${share(to) - share(from)}%` }

  return (
    <div
      className={`track ${playing ? 'is-playing' : ''} ${dragging ? 'is-dragging' : ''}`}
      ref={track}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="track-plot" ref={plot}>
        <svg
          className="track-shape"
          viewBox={`-0.5 0 ${months.length} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="shape-older" d={shape.older} />
          <path className="shape-newer" d={shape.newer} />
        </svg>

        {recordLast < last && (
          <div className="track-after" style={{ left: `${share(recordLast)}%` }} title="After the record" />
        )}

        <div className="track-band" style={band} />

        {switchIndex >= 0 && (
          <div className="track-switch" style={{ left: `${share(switchIndex)}%` }} aria-hidden="true" />
        )}

        {playing && <div className="track-head" style={{ left: `${headAt}%` }} aria-hidden="true" />}

        {!playing && (
          <>
            <button
              type="button" role="slider" className="handle" ref={fromHandle}
              style={{ left: `${share(from)}%` }}
              aria-label="First month" aria-orientation="horizontal"
              aria-valuemin={0} aria-valuemax={to} aria-valuenow={from}
              aria-valuetext={formatMonth(months[from])}
              onKeyDown={onKey('from')}
            />
            <button
              type="button" role="slider" className="handle" ref={toHandle}
              style={{ left: `${share(to)}%` }}
              aria-label="Last month" aria-orientation="horizontal"
              aria-valuemin={from} aria-valuemax={recordLast} aria-valuenow={to}
              aria-valuetext={formatMonth(months[to])}
              onKeyDown={onKey('to')}
            />
          </>
        )}
      </div>

      <div className="track-years">
        {years.map(({ year, index, labelled, isSwitch }) => (
          <span key={year} className={`year ${isSwitch ? 'is-switch' : ''} ${labelled ? 'is-labelled' : ''}`} style={{ left: `${share(index)}%` }}>
            <i aria-hidden="true" />
            {labelled && (
              <button
                type="button" tabIndex={-1}
                disabled={index > recordLast}
                aria-label={isSwitch
                  ? `Show all of ${year}, the year the sharper camera took over`
                  : `Show all of ${year}`}
                onClick={() => pickYear(year)}
              >
                {isSwitch ? `▲ ${year}` : year}
              </button>
            )}
          </span>
        ))}
      </div>

      <p className="visually-hidden">
        The shape above the track is the total fire intensity in each month. Each side of
        February 2012 is drawn on its own scale, so the two sides cannot be compared.
      </p>
    </div>
  )
}
