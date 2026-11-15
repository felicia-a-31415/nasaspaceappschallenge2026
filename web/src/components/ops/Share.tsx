import { useEffect, useState } from 'react'
import { viewUrl } from '../../hooks/useView'
import type { SituationState } from '../../hooks/useSituation'
import { formatDate } from '../../lib/days'
import { count, megawatts, position } from '../../lib/format'
import { BASE_CREDIT } from '../../map/baseMap'
import type { HotspotArrays } from '../../types'
import type { View } from '../../view'

export interface ShareProps {
  view: View
  hotspots: HotspotArrays
  state: SituationState
  placeName: string | null
  getCanvas: () => HTMLCanvasElement | null
}

/** The situation as a few plain lines, to paste into a message or a log. */
export function summaryText({ view, hotspots, state, placeName }: Omit<ShareProps, 'getCanvas'>): string {
  const { board, cells } = state
  const { lat, lon, radius_km: radiusKm } = view
  const where = lat !== null && lon !== null
    ? `${placeName ? `${placeName} (${position(lat, lon)})` : position(lat, lon)}, within ${radiusKm} km`
    : 'Whole region'
  const lines = [
    `ITSS fire situation, ${formatDate(board.date)}`,
    `Area: ${where}`,
    `Satellite fire detections: ${count(board.day0.detections)} on the day, ${count(board.last3.detections)} in 3 days, `
      + `${count(board.last7.detections)} in 7 days (${count(board.prior7.detections)} in the 7 days before).`,
  ]
  if (board.nearest) lines.push(`Nearest fire in the last 7 days: ${Math.round(board.nearest.km)} km ${board.nearest.toward} of the point.`)
  if (cells.length) {
    lines.push('Most active areas, last 7 days:')
    cells.slice(0, 3).forEach((c, i) => lines.push(`  ${i + 1}. ${position(c.lat, c.lon)}: ${megawatts(c.sumFrp)}, ${count(c.detections)} detections`))
  }
  lines.push(
    `Source: NASA FIRMS (MODIS, VIIRS). Data to ${formatDate(hotspots.dataThrough)}. Not a live feed, not a fire perimeter.`,
    viewUrl(view),
  )
  return lines.join('\n')
}

/** The map as drawn, with a caption strip naming the day, the area and the sources. */
function mapImage(canvas: HTMLCanvasElement, caption: string): Promise<Blob | null> {
  const strip = Math.round(canvas.height * 0.045)
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height + strip
  const ctx = out.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(canvas, 0, 0)
  ctx.fillStyle = '#07090b'
  ctx.fillRect(0, canvas.height, out.width, strip)
  ctx.fillStyle = '#b6b3ac'
  ctx.font = `${Math.round(strip * 0.4)}px "IBM Plex Mono", monospace`
  ctx.textBaseline = 'middle'
  ctx.fillText(caption, strip * 0.4, canvas.height + strip / 2, out.width - strip * 0.8)
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'))
}

type Done = 'link' | 'summary' | 'map' | 'failed' | null

/**
 * Sharing, always in reach at the foot of the sheet: a link that reopens this exact
 * view, the situation as text, and the map as a picture.
 */
export function Share(props: ShareProps) {
  const { view, state, getCanvas } = props
  const [done, setDone] = useState<Done>(null)

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(null), 2200)
    return () => clearTimeout(timer)
  }, [done])

  const copy = async (what: 'link' | 'summary', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(what)
    } catch {
      setDone('failed')
    }
  }

  const saveMap = async () => {
    const canvas = getCanvas()
    if (!canvas) return
    const { lat, lon, radius_km: radiusKm } = view
    const area = lat !== null && lon !== null ? `${position(lat, lon)}, ${radiusKm} km` : 'whole region'
    const blob = await mapImage(canvas, `ITSS · 7 days to ${state.board.date} · ${area} · NASA FIRMS (MODIS, VIIRS) · ${BASE_CREDIT}`)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `itss_${state.board.date}.png`
    link.click()
    URL.revokeObjectURL(url)
    setDone('map')
  }

  return (
    <div className="share" role="group" aria-label="Share">
      <span className="share-label">Share</span>
      <button type="button" onClick={() => copy('link', viewUrl(view))} title="Copy a link that opens this place and day">
        {done === 'link' ? 'Copied' : 'Copy link'}
      </button>
      <button type="button" onClick={() => copy('summary', summaryText(props))} title="Copy the situation as text, to paste into a message">
        {done === 'summary' ? 'Copied' : 'Copy summary'}
      </button>
      <button type="button" onClick={saveMap} title="Save the map as a picture, with a caption">
        {done === 'map' ? 'Saved' : 'Save map'}
      </button>
      <span className="visually-hidden" role="status">
        {done === 'failed' ? 'Could not copy. Copy the address from the browser instead.' : done ? 'Done' : ''}
      </span>
    </div>
  )
}
