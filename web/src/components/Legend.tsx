import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { Z_BREAKS, Z_COLOURS } from '../map/anomaly'
import type { Anomaly } from '../map/anomaly'
import { cssColour, intensityFraction, LEGEND_TICKS, rampColour, TOP_INTENSITY_MW } from '../map/colourRamp'
import { FIELD_GONE_ZOOM } from '../map/field'
import { FRP_CLASS_COLOURS } from '../map/frpCells'
import type { Encoding } from './MapControls'

const GRADIENT = Array.from({ length: 11 }, (_, i) => {
  const f = i / 10
  return `${cssColour(rampColour(f))} ${(f * 100).toFixed(0)}%`
}).join(', ')

const FRP_CELL_BOUNDS = ['10', '100', '1 k', '10 k', '100 k']
const Z_BOUNDS = Z_BREAKS.map((z) => (z > 0 ? `+${z}` : String(z).replace('-', '−')))

export interface LegendProps {
  map: MapLibreMap | null
  encoding: Encoding
  /** The anomaly for the chosen period, or why there is none. Null while playing. */
  anomaly: Anomaly | null
  /** ΣFRP grid cells are drawn when zoomed out. */
  cells: boolean
}

/** A stepped scale: one swatch per class, the class boundaries written between them. */
function Steps({ colours, bounds }: { colours: [number, number, number][]; bounds: string[] }) {
  return (
    <>
      <div className="legend-steps">
        {colours.map((colour, i) => <i key={i} style={{ background: cssColour(colour) }} />)}
      </div>
      <div className="legend-bounds">
        {bounds.map((label, i) => <span key={label} style={{ left: `${((i + 1) / colours.length) * 100}%` }}>{label}</span>)}
      </div>
    </>
  )
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
              <Steps colours={Z_COLOURS} bounds={Z_BOUNDS} />
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
        <p className="legend-title">Summed FRP <span>MW per 0.1° cell</span></p>
        <Steps colours={FRP_CLASS_COLOURS} bounds={FRP_CELL_BOUNDS} />
      </div>
    )
  }

  return (
    <div className="legend">
      <p className="legend-title">FRP <span>MW per detection</span></p>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${GRADIENT})` }} />
      <div className="legend-bounds">
        {LEGEND_TICKS.map((mw) => (
          <span key={mw} style={{ left: `${intensityFraction(mw) * 100}%` }}>{mw === TOP_INTENSITY_MW ? `≥${mw}` : mw}</span>
        ))}
      </div>
    </div>
  )
}
