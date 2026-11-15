import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { Z_BREAKS, Z_COLOURS } from '../map/anomaly'
import type { Anomaly } from '../map/anomaly'
import { cssColour, intensityFraction, LEGEND_TICKS, rampColour, TOP_INTENSITY_MW } from '../map/colourRamp'
import { FIELD_GONE_ZOOM } from '../map/field'
import { FRP_CLASS_COLOURS } from '../map/frpCells'
import type { Encoding } from './MapControls'

function gradient(colourAt: (f: number) => [number, number, number], stops = 16): string {
  return Array.from({ length: stops + 1 }, (_, i) => {
    const f = i / stops
    return `${cssColour(colourAt(f))} ${(f * 100).toFixed(1)}%`
  }).join(', ')
}

/**
 * A smooth gradient through a set of class colours: each colour sits at the centre of
 * its class, and the bar blends between neighbours. Same palette the map uses.
 */
function classGradient(colours: [number, number, number][]): string {
  const n = colours.length
  return colours.map((c, i) => `${cssColour(c)} ${(((i + 0.5) / n) * 100).toFixed(1)}%`).join(', ')
}

/** Labels at the class boundaries, the same places the old stepped legend put them. */
function boundaryTicks(labels: string[], classes: number): Tick[] {
  return labels.map((label, i) => ({ at: (i + 1) / classes, label }))
}

const FRP_GRADIENT = gradient(rampColour)
const Z_GRADIENT = classGradient(Z_COLOURS)
const FRP_CELL_GRADIENT = classGradient(FRP_CLASS_COLOURS)

const Z_TICKS = boundaryTicks(Z_BREAKS.map((z) => (z > 0 ? `+${z}` : String(z).replace('-', '−'))), Z_COLOURS.length)
const FRP_CELL_TICKS = boundaryTicks(['10', '100', '1 k', '10 k', '100 k'], FRP_CLASS_COLOURS.length)
const FRP_TICKS: Tick[] = LEGEND_TICKS.map((mw) => ({
  at: intensityFraction(mw),
  label: mw === TOP_INTENSITY_MW ? `≥${mw}` : String(mw),
}))

interface Tick { at: number; label: string }

/** A continuous colour bar with tick marks and labels beneath, and a caption under those. */
function ColourBar({ background, ticks, caption }: { background: string; ticks: Tick[]; caption?: string }) {
  return (
    <div className="colourbar">
      <div className="colourbar-bar" style={{ background: `linear-gradient(90deg, ${background})` }} />
      <div className="colourbar-ticks">
        {ticks.map((t) => (
          <span key={t.label} style={{ left: `${t.at * 100}%` }}>{t.label}</span>
        ))}
      </div>
      {caption && <p className="colourbar-caption">{caption}</p>}
    </div>
  )
}

export interface LegendProps {
  map: MapLibreMap | null
  encoding: Encoding
  /** The anomaly for the chosen period, or why there is none. Null while playing. */
  anomaly: Anomaly | null
  /** ΣFRP grid cells are drawn when zoomed out. */
  cells: boolean
}

/** One scale, for whatever the map is drawing right now, with its unit. Nothing else. */
export function Legend({ map, encoding, anomaly, cells }: LegendProps) {
  const [zoom, setZoom] = useState(4)
  useEffect(() => {
    if (!map) return
    // Rounded the way the map layer rounds it, so the legend and the layer switch together.
    const read = () => setZoom(Math.round(map.getZoom() * 10) / 10)
    read()
    map.on('zoom', read)
    return () => { map.off('zoom', read) }
  }, [map])

  if (encoding === 'anomaly') {
    return (
      <div className="legend">
        <p className="legend-title">Fire-day anomaly <span>z per 0.1° cell</span></p>
        {anomaly?.ok
          ? (
            <>
              <ColourBar background={Z_GRADIENT} ticks={Z_TICKS} caption="Below normal ← → Above normal" />
              <p className="legend-foot">vs. same months, {anomaly.era} {Math.min(...anomaly.years)}–{Math.max(...anomaly.years)}</p>
            </>
          )
          : <p className="legend-note">{anomaly ? anomaly.reason : 'Paused during playback.'}</p>}
      </div>
    )
  }

  if (cells && zoom < FIELD_GONE_ZOOM) {
    return (
      <div className="legend">
        <p className="legend-title">Summed fire intensity <span>MW per 0.1° cell</span></p>
        <ColourBar background={FRP_CELL_GRADIENT} ticks={FRP_CELL_TICKS} />
      </div>
    )
  }

  return (
    <div className="legend">
      <p className="legend-title">Fire intensity <span>MW per detection</span></p>
      <ColourBar background={FRP_GRADIENT} ticks={FRP_TICKS} />
    </div>
  )
}
