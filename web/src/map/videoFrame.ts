// The overlays drawn into the exported video. Anything drawn as HTML on the page is not
// part of the map's canvas, so everything the viewer needs - the date, the legend, the
// 2012 notice and the credits - is painted into the frame here.

import { formatMonth, SWITCH_MONTH } from '../lib/days'
import { cssColour, intensityFraction, LEGEND_TICKS, rampColour, TOP_INTENSITY_MW } from './colourRamp'

export interface FrameState {
  /** YYYY-MM the run has reached. */
  month: string
  /** 0 to 1 along the months this video covers. */
  progress: number
  /** Where February 2012 falls along those months, 0 to 1. Null when they do not cross it. */
  switchAt: number | null
  /** The months this video covers: the whole record, or the chosen period. */
  months: string[]
}

const INK = '#f6f3ee'
const DIM = '#c3bfb7'
const PANEL = 'rgba(12, 12, 16, 0.78)'

/** Scale and offset that make `source` cover a `width` by `height` frame. */
export function cover(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  return {
    scale,
    x: (width - sourceWidth * scale) / 2,
    y: (height - sourceHeight * scale) / 2,
  }
}

function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = PANEL
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1
  ctx.stroke()
}

/** Everything the page shows around the map, laid out for a 16:9 frame. */
export function drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, state: FrameState) {
  const pad = Math.round(width * 0.022)
  const unit = width / 1920            // the layout is designed at 1920 wide

  // Title, top left.
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = INK
  ctx.font = `650 ${34 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  ctx.fillText('Quebec fire record', pad, pad + 34 * unit)
  ctx.fillStyle = DIM
  ctx.font = `${20 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  ctx.fillText('Fire detections seen by satellite, played through time', pad, pad + 64 * unit)
  ctx.fillText('Detections stay on the map from the first date on the time line', pad, pad + 90 * unit)

  // The month, top right, large.
  ctx.textAlign = 'right'
  ctx.fillStyle = INK
  ctx.font = `650 ${72 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  ctx.fillText(formatMonth(state.month), width - pad, pad + 66 * unit)
  ctx.textAlign = 'left'

  drawLegend(ctx, pad, height - pad - 150 * unit, unit)
  drawTimeline(ctx, width, height, pad, unit, state)

  // Credits, bottom right, above the time line.
  ctx.textAlign = 'right'
  ctx.fillStyle = DIM
  ctx.font = `${17 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  ctx.fillText('Fire data: NASA FIRMS (MODIS, VIIRS)', width - pad, height - pad - 118 * unit)
  ctx.fillText('Base map © OpenStreetMap contributors, © CARTO', width - pad, height - pad - 94 * unit)
  ctx.textAlign = 'left'
}

function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, unit: number) {
  const w = 360 * unit
  const h = 16 * unit
  roundedBox(ctx, x - 12 * unit, y - 34 * unit, w + 24 * unit, h + 66 * unit, 10 * unit)

  ctx.fillStyle = INK
  ctx.font = `600 ${18 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  ctx.fillText('Fire intensity of each detection, megawatts', x, y - 12 * unit)

  const ramp = ctx.createLinearGradient(x, 0, x + w, 0)
  for (let i = 0; i <= 10; i++) ramp.addColorStop(i / 10, cssColour(rampColour(i / 10)))
  ctx.fillStyle = ramp
  ctx.fillRect(x, y, w, h)

  ctx.fillStyle = DIM
  ctx.font = `${15 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  for (const mw of LEGEND_TICKS) {
    const at = x + intensityFraction(mw) * w
    const label = mw === TOP_INTENSITY_MW ? `${mw}+` : String(mw)
    ctx.textAlign = mw === 0 ? 'left' : mw === TOP_INTENSITY_MW ? 'right' : 'center'
    ctx.fillText(label, at, y + h + 18 * unit)
  }
  ctx.textAlign = 'left'
}

function drawTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pad: number,
  unit: number,
  state: FrameState,
) {
  const y = height - pad - 48 * unit
  const left = pad
  const right = width - pad
  const track = right - left

  // The notice that gives the whole animation its meaning.
  ctx.fillStyle = '#ffd27d'
  ctx.font = `${19 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  ctx.fillText(
    'From February 2012 a sharper satellite camera took over and sees many more small fires. '
    + 'More dots after 2012 does not by itself mean more fire.',
    left, y - 22 * unit,
  )

  ctx.fillStyle = '#33333d'
  ctx.fillRect(left, y, track, 7 * unit)
  ctx.fillStyle = INK
  ctx.fillRect(left, y, track * Math.min(1, Math.max(0, state.progress)), 7 * unit)

  ctx.font = `${15 * unit}px "IBM Plex Sans", system-ui, sans-serif`
  if (state.switchAt !== null) {
    const switchX = left + track * state.switchAt
    ctx.fillStyle = '#ffd27d'
    ctx.fillRect(switchX - 1 * unit, y - 9 * unit, 2 * unit, 25 * unit)
    ctx.textAlign = 'center'
    ctx.fillText(formatMonth(SWITCH_MONTH), switchX, y + 34 * unit)
  }

  ctx.fillStyle = DIM
  ctx.textAlign = 'left'
  ctx.fillText(formatMonth(state.months[0]), left, y + 34 * unit)
  ctx.textAlign = 'right'
  ctx.fillText(formatMonth(state.months[state.months.length - 1]), right, y + 34 * unit)
  ctx.textAlign = 'left'
}
