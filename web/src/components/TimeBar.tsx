import { useEffect, useRef } from 'react'
import { dayToMonth, formatMonth, SWITCH_MONTH } from '../lib/days'
import type { Timeline } from '../hooks/useTimeline'
import { ExportVideo } from './ExportVideo'

const SPEEDS = [0.5, 1, 2]

/** Where February 2012 falls along the track, as a percentage. */
function switchPosition(months: string[]): number {
  const at = months.indexOf(SWITCH_MONTH)
  return at < 0 ? 0 : (at / (months.length - 1)) * 100
}

export interface TimeBarProps {
  timeline: Timeline
  epoch: string
  /** The map's own canvas, for the video export. */
  getCanvas: () => HTMLCanvasElement | null
}

export function TimeBar({ timeline, epoch, getCanvas }: TimeBarProps) {
  const { months, playing, head, monthRange, speed } = timeline
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

  const last = months.length - 1
  const [from, to] = monthRange
  const headMonth = dayToMonth(epoch, head)
  const headAt = (Math.max(0, months.indexOf(headMonth)) / last) * 100

  // Read the range as it is now: both handles can move in the same tick.
  const setFrom = (value: number) => timeline.setMonthRange(([, end]) => [Math.min(value, end), end])
  const setTo = (value: number) => timeline.setMonthRange(([start]) => [start, Math.max(value, start)])

  return (
    <div className="timebar panel-surface" ref={bar}>
      <div className="timebar-head">
        <button
          type="button"
          className="play"
          onClick={() => (playing ? timeline.pause() : timeline.play())}
          aria-label={playing ? 'Pause' : 'Play from the start of the record'}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>

        <div className="speeds" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => timeline.setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>

        <ExportVideo timeline={timeline} epoch={epoch} getCanvas={getCanvas} />

        <p className="readout" aria-live="polite">
          {playing
            ? formatMonth(headMonth)
            : from === to
              ? formatMonth(months[from])
              : `${formatMonth(months[from])} to ${formatMonth(months[to])}`}
        </p>
      </div>

      <div className={`slider ${playing ? 'is-playing' : ''}`}>
        <div className="slider-track" />
        <div
          className="slider-fill"
          style={playing
            ? { left: 0, right: `${100 - headAt}%` }
            : { left: `${(from / last) * 100}%`, right: `${100 - (to / last) * 100}%` }}
        />
        <div className="slider-switch" style={{ left: `${switchPosition(months)}%` }} aria-hidden="true">
          <span>Feb 2012</span>
        </div>
        {!playing && (
          <>
            <input
              type="range" min={0} max={last} value={from} className="slider-input"
              onChange={(e) => setFrom(Number(e.target.value))}
              aria-label="First month" aria-valuetext={formatMonth(months[from])}
            />
            <input
              type="range" min={0} max={last} value={to} className="slider-input"
              onChange={(e) => setTo(Number(e.target.value))}
              aria-label="Last month" aria-valuetext={formatMonth(months[to])}
            />
          </>
        )}
      </div>

      <div className="slider-ends small muted">
        <span>{formatMonth(months[0])}</span>
        <span>{playing ? 'Playing from 2000 to now' : 'Drag either end to choose a period'}</span>
        <span>{formatMonth(months[last])}</span>
      </div>

      <p className="notice">
        <span aria-hidden="true">▲</span>
        From 2012 a sharper satellite camera took over and sees many more small fires.
        More dots after 2012 does not by itself mean more fire.
      </p>
    </div>
  )
}
