import { useCallback, useEffect, useRef, useState } from 'react'
import { dayToMonth, monthEndDay, monthRange, monthStartDay } from '../lib/days'
import type { HotspotArrays } from '../types'

/** A full run through the record, at normal speed. */
const RUN_SECONDS = 36

export interface Timeline {
  /** Every month of the record, YYYY-MM. */
  months: string[]
  playing: boolean
  /** How far the animation has reached, in days since the epoch. */
  head: number
  /** What the map shows: first and last visible day. */
  dayRange: [number, number]
  /** What every other request asks about: indices into `months`, inclusive. */
  monthRange: [number, number]
  speed: number
  play: () => void
  pause: () => void
  setMonthRange: (update: (current: [number, number]) => [number, number]) => void
  setSpeed: (speed: number) => void
}

/**
 * Time runs once from the first hotspot to the last, then hands over to a two-handled
 * range. Only the day numbers change while playing: the dots themselves are filtered on
 * the graphics card, and no request is made until the animation stops.
 */
export function useTimeline(hotspots: HotspotArrays | null, autoPlay = true): Timeline {
  const [months, setMonths] = useState<string[]>([])
  const [playing, setPlaying] = useState(false)
  const [head, setHead] = useState(0)
  const [monthSpan, setMonthSpan] = useState<[number, number]>([0, 0])
  const [speed, setSpeed] = useState(1)

  const epoch = hotspots?.epoch ?? '2000-01-01'
  const minDay = hotspots?.minDay ?? 0
  const maxDay = hotspots?.maxDay ?? 0
  const headRef = useRef(head)
  headRef.current = head

  // The record arrived: lay out its months and start the run.
  useEffect(() => {
    if (!hotspots) return
    const list = monthRange(dayToMonth(hotspots.epoch, hotspots.minDay), dayToMonth(hotspots.epoch, hotspots.maxDay))
    setMonths(list)
    setMonthSpan([0, list.length - 1])
    setHead(hotspots.minDay)
    setPlaying(autoPlay)
  }, [hotspots, autoPlay])

  // The run itself. Where it has reached is worked out from the clock rather than
  // added up frame by frame, so the length of a run never depends on the frame rate.
  useEffect(() => {
    if (!playing || !hotspots) return
    const perSecond = ((maxDay - minDay) / RUN_SECONDS) * speed
    const startedAt = performance.now()
    const startedFrom = headRef.current >= maxDay ? minDay : headRef.current
    let frame = 0
    const step = (now: number) => {
      const reached = startedFrom + ((now - startedAt) / 1000) * perSecond
      if (reached >= maxDay) {
        setHead(maxDay)
        setPlaying(false)
        return
      }
      setHead(reached)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, hotspots, minDay, maxDay, speed])

  const play = useCallback(() => {
    setHead((current) => (current >= maxDay ? minDay : current))
    setPlaying(true)
  }, [minDay, maxDay])

  // Pausing hands the chosen range to the rest of the page, up to where the run reached.
  const pause = useCallback(() => {
    setPlaying(false)
    setMonthSpan(([from]) => {
      const reached = months.indexOf(dayToMonth(epoch, head))
      return [from, reached < 0 ? months.length - 1 : reached]
    })
  }, [months, epoch, head])

  const dayRange: [number, number] = playing || !months.length
    ? [minDay, head]
    : [monthStartDay(epoch, months[monthSpan[0]]), monthEndDay(epoch, months[monthSpan[1]])]

  return {
    months, playing, head, dayRange, monthRange: monthSpan, speed,
    play, pause, setMonthRange: setMonthSpan, setSpeed,
  }
}
