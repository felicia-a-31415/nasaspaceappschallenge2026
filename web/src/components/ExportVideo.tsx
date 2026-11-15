import { useRef, useState } from 'react'
import type { Timeline } from '../hooks/useTimeline'
import { dayToMonth, SWITCH_MONTH } from '../lib/days'
import { canRecord, recordRun } from '../map/recordRun'
import { drawFrame } from '../map/videoFrame'

export interface ExportVideoProps {
  timeline: Timeline
  epoch: string
  /** The map's own canvas, which is what the recording copies from. */
  getCanvas: () => HTMLCanvasElement | null
}

/**
 * Records one full run and saves it as a video file. The frame holds what the viewer sees
 * on the map, with the date, the legend, the 2012 notice and the credits painted in,
 * because overlays drawn as HTML are not part of the canvas.
 */
export function ExportVideo({ timeline, epoch, getCanvas }: ExportVideoProps) {
  const [recording, setRecording] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const live = useRef(timeline)
  live.current = timeline

  if (!canRecord()) return null

  async function start() {
    const canvas = getCanvas()
    if (!canvas) return
    setProblem(null)
    setRecording(true)
    timeline.replay()

    let started = false
    try {
      const video = await recordRun({
        source: canvas,
        drawOverlay: (ctx, width, height) => {
          const { months, head } = live.current
          if (!months.length) return
          const at = months.indexOf(dayToMonth(epoch, head))
          drawFrame(ctx, width, height, {
            month: months[Math.max(0, at)],
            progress: at / (months.length - 1),
            switchAt: Math.max(0, months.indexOf(SWITCH_MONTH)) / (months.length - 1),
            months,
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
      link.download = 'quebec-fire-record.webm'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The recording did not finish.')
    } finally {
      setRecording(false)
    }
  }

  return (
    <>
      <button type="button" className="export" onClick={start} disabled={recording}>
        {recording
          ? `Recording… ${Math.round(recordedShare(timeline, epoch) * 100)}%`
          : '⬇ Save video'}
      </button>
      {problem && <span className="small warn-inline" role="alert">{problem}</span>}
    </>
  )
}

/** How far through the run the recording is, as a share of the months. */
function recordedShare(timeline: Timeline, epoch: string): number {
  if (timeline.months.length < 2) return 0
  const at = timeline.months.indexOf(dayToMonth(epoch, timeline.head))
  return Math.max(0, at) / (timeline.months.length - 1)
}
