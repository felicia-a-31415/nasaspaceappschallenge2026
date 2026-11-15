import { useEffect, useRef, useState } from 'react'
import type { Timeline } from '../hooks/useTimeline'
import { dayToMonth, formatMonthShort, monthEndDay, monthRange, monthStartDay, SWITCH_MONTH } from '../lib/days'
import { canRecord, recordRun } from '../map/recordRun'
import { drawFrame } from '../map/videoFrame'

export interface ExportVideoProps {
  timeline: Timeline
  epoch: string
  /** The map's own canvas, which is what the recording copies from. */
  getCanvas: () => HTMLCanvasElement | null
}

type Stretch = 'record' | 'period'

/** Short by default, so the file drops straight into a 30-second submission video. */
const LENGTHS = [15, 30]

/**
 * Records a run and saves it as a video file: the whole record or just the chosen
 * period, in about 15 or 30 seconds. The frame holds what the viewer sees on the map,
 * with the date, the legend, the 2012 notice and the credits painted in, because overlays
 * drawn as HTML are not part of the canvas.
 */
export function ExportVideo({ timeline, epoch, getCanvas }: ExportVideoProps) {
  const [open, setOpen] = useState(false)
  const [stretch, setStretch] = useState<Stretch>('record')
  const [seconds, setSeconds] = useState(LENGTHS[0])
  const [recording, setRecording] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const live = useRef(timeline)
  live.current = timeline
  const box = useRef<HTMLDivElement>(null)

  // Click away or press Escape to close the options.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  if (!canRecord()) return null

  const { months, monthRange: span, recordLast } = timeline
  const periodLabel = months.length
    ? span[0] === span[1]
      ? formatMonthShort(months[span[0]])
      : `${formatMonthShort(months[span[0]])} – ${formatMonthShort(months[span[1]])}`
    : ''

  async function start() {
    const canvas = getCanvas()
    if (!canvas || !months.length) return
    setOpen(false)
    setProblem(null)
    setRecording(true)

    // The months this video runs across: its own time line is drawn from these.
    const first = stretch === 'period' ? months[span[0]] : months[0]
    const last = stretch === 'period' ? months[span[1]] : months[recordLast]
    const shown = monthRange(first, last)
    const fromDay = Math.max(timeline.recordStartDay, monthStartDay(epoch, first))
    const toDay = Math.min(timeline.recordEndDay, monthEndDay(epoch, last))
    const switchAt = shown.indexOf(SWITCH_MONTH)
    timeline.playRun({ fromDay, toDay, seconds })

    let started = false
    try {
      const video = await recordRun({
        source: canvas,
        drawOverlay: (ctx, width, height) => {
          const { head } = live.current
          drawFrame(ctx, width, height, {
            month: dayToMonth(epoch, Math.min(toDay, Math.max(fromDay, head))),
            progress: (head - fromDay) / Math.max(1, toDay - fromDay),
            switchAt: switchAt > 0 && shown.length > 1 ? switchAt / (shown.length - 1) : null,
            months: shown,
          })
        },
        isDone: () => {
          if (live.current.playing) started = true
          return started && !live.current.playing
        },
      })
      const url = URL.createObjectURL(video)
      const link = document.createElement('a')
      link.href = url
      link.download = stretch === 'period'
        ? `quebec-fire-record-${first}-to-${last}.webm`
        : 'quebec-fire-record.webm'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The recording did not finish.')
    } finally {
      setRecording(false)
    }
  }

  const run = timeline.run
  const done = recording && run
    ? Math.min(1, Math.max(0, (timeline.head - run.fromDay) / Math.max(1, run.toDay - run.fromDay)))
    : 0

  return (
    <div className="export" ref={box}>
      <button
        type="button"
        className="quiet"
        onClick={() => setOpen((o) => !o)}
        disabled={recording}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {recording ? `Recording ${Math.round(done * 100)}%` : 'Export WebM'}
      </button>
      {problem && <span className="small warn-inline" role="alert">{problem}</span>}

      {open && (
        <div className="popover surface" role="dialog" aria-label="Export animation">
          <fieldset>
            <legend>Time span</legend>
            <label>
              <input type="radio" name="stretch" checked={stretch === 'record'} onChange={() => setStretch('record')} />
              Full record
            </label>
            <label>
              <input type="radio" name="stretch" checked={stretch === 'period'} onChange={() => setStretch('period')} />
              Selected period <span className="muted">({periodLabel})</span>
            </label>
          </fieldset>
          <fieldset>
            <legend>Duration</legend>
            {LENGTHS.map((s) => (
              <label key={s}>
                <input type="radio" name="seconds" checked={seconds === s} onChange={() => setSeconds(s)} />
                {s} s
              </label>
            ))}
          </fieldset>
          <button type="button" className="primary" onClick={start}>Record</button>
          <p className="small muted">
            1920 × 1080 WebM of the current map frame, with date, FRP legend, sensor-transition
            note and credits burned in. Keep this tab in the foreground while recording.
          </p>
        </div>
      )}
    </div>
  )
}
