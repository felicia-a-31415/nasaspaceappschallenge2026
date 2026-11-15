import { BASE_MAPS } from '../map/baseMap'
import type { BaseMap } from '../map/baseMap'

/** A: fire radiative power of each detection. B: standardized anomaly of each cell. */
export type Encoding = 'frp' | 'anomaly'

export interface MapLayers {
  base: BaseMap
  encoding: Encoding
  /** Summed FRP per 0.1 degree cell, drawn in place of detections when zoomed out. */
  field: boolean
  /** While playing, detections just behind the playhead are drawn brighter. */
  flare: boolean
  graticule: boolean
  labels: boolean
  /** Outlines of the cells with the highest summed FRP. */
  squares: boolean
}

export interface MapControlsProps {
  layers: MapLayers
  onLayers: (change: Partial<MapLayers>) => void
  radii: number[]
  radiusKm: number
  onRadius: (km: number) => void
  /** The situation board is up: only the controls that still apply to it are offered. */
  board?: boolean
}

const ENCODINGS: { id: Encoding; label: string; title: string }[] = [
  { id: 'frp', label: 'A · FRP', title: 'Fire radiative power of each detection, MW' },
  { id: 'anomaly', label: 'B · Anomaly', title: 'Standardized anomaly (z) of fire-days per 0.1° cell against the same sensor’s other years' },
]

const OVERLAYS: { key: 'field' | 'flare' | 'graticule' | 'labels' | 'squares'; label: string; title?: string }[] = [
  {
    key: 'field',
    label: 'ΣFRP grid cells (zoom < 7.5)',
    title: 'Encoding A: summed FRP per 0.1° cell over the period, in decade classes. Individual detections above zoom 7.5 and during playback.',
  },
  { key: 'flare', label: 'Emphasize new detections', title: 'During playback, detections just behind the playhead are drawn brighter.' },
  { key: 'squares', label: 'Top 10 cells by ΣFRP', title: 'The ten 0.1° cells with the highest summed FRP in the period.' },
  { key: 'graticule', label: 'Graticule' },
  { key: 'labels', label: 'Place names' },
]

const BOARD_OVERLAYS: typeof OVERLAYS = [
  { key: 'squares', label: 'Most active cells', title: 'The 0.1° cells with the highest summed FRP in the 7 days to the as-of day.' },
  { key: 'graticule', label: 'Graticule' },
  { key: 'labels', label: 'Place names' },
]

/** Layer and parameter controls: base map, colour encoding, overlays, analysis radius. */
export function MapControls({ layers, onLayers, radii, radiusKm, onRadius, board = false }: MapControlsProps) {
  return (
    <div className="mapctl" aria-label="Layers and parameters">
      <div className="mapctl-group">
        <p className="eyebrow">Colour encoding</p>
        <div className="seg seg-fill" role="group" aria-label="Colour encoding">
          {ENCODINGS.map(({ id, label, title }) => (
            <button key={id} type="button" title={title} aria-pressed={layers.encoding === id} onClick={() => onLayers({ encoding: id })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mapctl-group">
        <p className="eyebrow">Base map</p>
        <div className="seg seg-fill" role="group" aria-label="Base map">
          {BASE_MAPS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={layers.base === id} onClick={() => onLayers({ base: id })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mapctl-group">
        <p className="eyebrow">Overlays</p>
        {(board ? BOARD_OVERLAYS : OVERLAYS).map(({ key, label, title }) => (
          <label key={key} className="check" title={title}>
            <input type="checkbox" checked={layers[key]} onChange={(e) => onLayers({ [key]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {!board && <div className="mapctl-group">
        <p className="eyebrow">Analysis radius</p>
        <div className="seg seg-fill" role="group" aria-label="Radius of the area of interest">
          {radii.map((km) => (
            <button key={km} type="button" aria-pressed={km === radiusKm} onClick={() => onRadius(km)}>
              {km} km
            </button>
          ))}
        </div>
      </div>}
    </div>
  )
}
