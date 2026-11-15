import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dayToMonth, monthEndDay, monthRange, monthStartDay } from '../lib/days'
import type { MonthSpan } from '../lib/rangeDrag'
import type { HotspotArrays } from '../types'

/** A run through the whole record, at normal speed. A shorter period takes less. */
export const RUN_SECONDS = 36
/** However short the period, a run is never over before it can be watched. */
const MIN_RUN_SECONDS = 8

export interface RunRequest {
  fromDay: number
  toDay: number
  /** How long the run should take, whatever the speed buttons say. */
  seconds: number
}

interface Run {
  fromDay: number
  toDay: number
  seconds: number
  /** A recording: its length is fixed and it leaves the chosen period alone. */
  fixed: boolean
}

export interface TimelineOptions {
  /** The chosen period, YYYY-MM, as the view holds it. Null is that end of the record. */
  from: string | null
  to: string | null
  /** The user chose a period. Null for an end means "that end of the record". */
  onRange: (from: string | null, to: string | null) => void
  autoPlay?: boolean
  /**
   * A date after the last day of data that the time track should still reach. Nothing
   * uses the room yet: it is there so that something dated after the record, such as a
   * forecast, has somewhere to go. The record's own end is `recordLast` and `recordEndDay`.
   */
  extendTo?: string | null
}

export interface Timeline {
  /** Every month on the track, YYYY-MM. Normally the record; longer if extended. */
  months: string[]
  /** Index in `months` of the last month the record reaches. */
  recordLast: number
  /** First and last day that hold data, in days since the epoch. */
  recordStartDay: number
  recordEndDay: number
  playing: boolean
  /** How far the animation has reached, in days since the epoch. */
  head: number
  /** What the map shows: first and last visible day. */
  dayRange: [number, number]
  /** What every other request asks about: indices into `months`, inclusive. */
  monthRange: MonthSpan
  /** The days the current run started and will stop at, or null when nothing is playing. */
  run: { fromDay: number; toDay: number } | null
  speed: number
  /** Play through the chosen period, or carry on a run that was paused. */
  play: () => void
  pause: () => void
  /** Move the playhead while playing. */
  seek: (day: number) => void
  /** Play a set stretch in a set time, for the video export. */
  playRun: (request: RunRequest) => void
  setMonthRange: (span: MonthSpan) => void
  setSpeed: (speed: number) => void
}

/**
 * Time rests on a two-handled month range, A to B. Playing runs through that period:
 * the map shows everything from A up to the playhead, so fires stay once they appear,
 * and nothing from before A is ever shown. Only day numbers change while playing: the
 * dots are filtered on the graphics card, and no request is made until it stops.
 *
 * The chosen period itself belongs to the view (see view.ts); this hook reads it and
 * reports changes, and owns only what is about playback.
 */
export function useTimeline(hotspots: HotspotArrays | null, options: TimelineOptions): Timeline {
  const { from, to, onRange, autoPlay = true, extendTo = null } = options
  const [playing, setPlaying] = useState(false)
  const [head, setHead] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [run, setRun] = useState<Run | null>(null)
  /** Bumped to restart the clock when the playhead is moved by hand mid-run. */
  const [restart, setRestart] = useState(0)

  const epoch = hotspots?.epoch ?? '2000-01-01'
  const minDay = hotspots?.minDay ?? 0
  const maxDay = hotspots?.maxDay ?? 0

  const { months, recordLast } = useMemo(() => {
    if (!hotspots) return { months: [] as string[], recordLast: 0 }
    const first = dayToMonth(hotspots.epoch, hotspots.minDay)
    const last = dayToMonth(hotspots.epoch, hotspots.maxDay)
    const end = extendTo && extendTo.slice(0, 7) > last ? extendTo.slice(0, 7) : last
    return { months: monthRange(first, end), recordLast: monthRange(first, last).length - 1 }
  }, [hotspots, extendTo])

  // The view's months as positions on the track. A month the track does not hold (a link
  // from a longer record, say) falls back to that end of the record.
  const monthSpan: MonthSpan = useMemo(() => {
    if (!months.length) return [0, 0]
    const a = from ? months.indexOf(from) : 0
    const b = to ? months.indexOf(to) : recordLast
    const start = a < 0 ? 0 : a
    const end = b < 0 ? recordLast : b
    return start <= end ? [start, end] : [end, start]
  }, [months, recordLast, from, to])

  const headRef = useRef(head)
  headRef.current = head
  const live = useRef({ months, recordLast, monthSpan, epoch, minDay, maxDay, onRange })
  live.current = { months, recordLast, monthSpan, epoch, minDay, maxDay, onRange }
  /** The run that was paused, so play can carry on to where it was heading. */
  const paused = useRef<Run | null>(null)

  /** Tell the view which months a stretch of days covers. */
  const report = useCallback((fromDay: number, toDay: number) => {
    const now = live.current
    const a = Math.max(0, now.months.indexOf(dayToMonth(now.epoch, fromDay)))
    const b = now.months.indexOf(dayToMonth(now.epoch, toDay))
    const end = b < 0 ? now.recordLast : b
    // The whole record is "no limits", so a link to it keeps up as the record grows.
    now.onRange(a === 0 ? null : now.months[a], end === now.recordLast ? null : now.months[end])
  }, [])

  /** How long a run across these days takes at normal speed. */
  const secondsFor = useCallback((fromDay: number, toDay: number) => {
    const share = (toDay - fromDay) / Math.max(1, maxDay - minDay)
    return Math.min(RUN_SECONDS, Math.max(MIN_RUN_SECONDS, share * RUN_SECONDS))
  }, [minDay, maxDay])

  // The record arrived. A plain address plays it from the start; a link that names a
  // view is shown as it is, because playing would replace what the link was sent to show.
  const started = useRef(false)
  useEffect(() => {
    if (!hotspots || started.current) return
    started.current = true
    setHead(hotspots.minDay)
    if (autoPlay) {
      setRun({ fromDay: hotspots.minDay, toDay: hotspots.maxDay, seconds: RUN_SECONDS, fixed: false })
      setPlaying(true)
    }
    // Only the arrival of the record starts anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots])

  // The run itself. Where it has reached is worked out from the clock rather than added
  // up frame by frame, so the length of a run never depends on the frame rate.
  useEffect(() => {
    if (!playing || !run) return
    const perSecond = (Math.max(1, run.toDay - run.fromDay) / run.seconds) * (run.fixed ? 1 : speed)
    const startedAt = performance.now()
    const startedFrom = headRef.current
    let frame = 0
    const step = (now: number) => {
      const reached = startedFrom + ((now - startedAt) / 1000) * perSecond
      if (reached >= run.toDay) {
        setHead(run.toDay)
        setPlaying(false)
        setRun(null)
        paused.current = null
        // The run showed A to B, so that is the period the page rests on.
        if (!run.fixed) report(run.fromDay, run.toDay)
        return
      }
      setHead(reached)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, run, speed, restart, report])

  const play = useCallback(() => {
    const now = live.current
    if (!now.months.length) return
    const [a, b] = now.monthSpan
    const was = paused.current
    const at = headRef.current
    // Carry on a paused run, as long as the period is still the one pausing left.
    if (was && at < was.toDay
      && now.months[a] === dayToMonth(now.epoch, was.fromDay)
      && now.months[b] === dayToMonth(now.epoch, at)) {
      setRun(was)
    } else {
      const fromDay = Math.max(now.minDay, monthStartDay(now.epoch, now.months[a]))
      const toDay = Math.min(now.maxDay, monthEndDay(now.epoch, now.months[b]))
      setHead(fromDay)
      setRun({ fromDay, toDay, seconds: secondsFor(fromDay, toDay), fixed: false })
    }
    paused.current = null
    setRestart((n) => n + 1)
    setPlaying(true)
  }, [secondsFor])

  const playRun = useCallback((request: RunRequest) => {
    const fromDay = Math.max(minDay, request.fromDay)
    const toDay = Math.min(maxDay, request.toDay)
    paused.current = null
    setHead(fromDay)
    setRun({ fromDay, toDay, seconds: Math.max(1, request.seconds), fixed: true })
    setRestart((n) => n + 1)
    setPlaying(true)
  }, [minDay, maxDay])

  // Pausing hands over what was on screen: from the start of the run to the playhead.
  const pause = useCallback(() => {
    setPlaying(false)
    setRun((current) => {
      if (current && !current.fixed) {
        paused.current = current
        report(current.fromDay, headRef.current)
      }
      return null
    })
  }, [report])

  const seek = useCallback((day: number) => {
    setHead(Math.min(run?.toDay ?? maxDay, Math.max(run?.fromDay ?? minDay, day)))
    setRestart((n) => n + 1)
  }, [run, minDay, maxDay])

  const setMonthRange = useCallback(([a, b]: MonthSpan) => {
    const now = live.current
    if (!now.months.length) return
    const start = Math.min(a, b)
    const end = Math.max(a, b)
    now.onRange(start === 0 ? null : now.months[start], end === now.recordLast ? null : now.months[end])
  }, [])

  const dayRange: [number, number] = playing && run
    ? [run.fromDay, head]
    : months.length
      ? [monthStartDay(epoch, months[monthSpan[0]]), monthEndDay(epoch, months[monthSpan[1]])]
      : [minDay, minDay]

  return {
    months, recordLast, recordStartDay: minDay, recordEndDay: maxDay,
    playing, head, dayRange, monthRange: monthSpan,
    run: playing && run ? { fromDay: run.fromDay, toDay: run.toDay } : null,
    speed, play, pause, seek, playRun, setMonthRange, setSpeed,
  }
}

/** Where a day falls along a track of `months`, 0 to 1, by the calendar. */
export function dayShare(epoch: string, months: string[], day: number): number {
  if (months.length < 2) return 0
  const first = monthStartDay(epoch, months[0])
  const last = monthStartDay(epoch, months[months.length - 1])
  return Math.min(1, Math.max(0, (day - first) / (last - first)))
}
