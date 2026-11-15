import { useEffect, useState } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

import { formatDate } from '../lib/days'
import { BASE_CREDIT } from '../map/baseMap'
import { PLACE_SEARCH_CREDIT } from '../places'

export interface StatusBarProps {
  map: MapLibreMap | null
  /** The last day the record holds, YYYY-MM-DD. */
  dataThrough?: string
}

/** Round lengths a scale bar may show, in metres. */
const SCALE_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000]
const SCALE_MAX_PX = 110

/** The widest round length that fits, and how many pixels it spans at this view. */
function scaleFor(lat: number, zoom: number): { px: number; label: string } {
  // MapLibre's zoom 0 is one 512 pixel tile around the equator.
  const metresPerPx = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
  const metres = SCALE_STEPS.findLast((step) => step / metresPerPx <= SCALE_MAX_PX) ?? SCALE_STEPS[0]
  return { px: metres / metresPerPx, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` }
}

function angle(value: number, positive: string, negative: string, width: number): string {
  return `${Math.abs(value).toFixed(4).padStart(width, '0')}°${value < 0 ? negative : positive}`
}

/**
 * The strip along the bottom edge: where the pointer is, how far in the map is, a scale,
 * and where the data and the map come from. It listens to the map itself, so moving the
 * pointer redraws this strip and nothing else.
 */
export function StatusBar({ map, dataThrough }: StatusBarProps) {
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null)
  const [view, setView] = useState<{ lat: number; zoom: number } | null>(null)

  useEffect(() => {
    if (!map) return
    const move = (event: MapMouseEvent) => setCursor({ lat: event.lngLat.lat, lon: event.lngLat.lng })
    const leave = () => setCursor(null)
    const read = () => setView({ lat: map.getCenter().lat, zoom: map.getZoom() })
    read()
    map.on('mousemove', move)
    map.on('mouseout', leave)
    map.on('move', read)
    return () => {
      map.off('mousemove', move)
      map.off('mouseout', leave)
      map.off('move', read)
    }
  }, [map])

  const scale = view ? scaleFor(view.lat, view.zoom) : null

  return (
    <footer className="statusbar">
      <span className="status-cell status-cursor" aria-hidden="true">
        <b>LAT</b> {cursor ? angle(cursor.lat, 'N', 'S', 7) : '––.––––°'}
        <b>LON</b> {cursor ? angle(cursor.lon, 'E', 'W', 8) : '––.––––°'}
      </span>
      <span className="status-cell" aria-hidden="true"><b>ZOOM</b> {view ? view.zoom.toFixed(1) : '–'}</span>
      {scale && (
        <span className="status-cell status-scale" aria-hidden="true">
          <i style={{ width: scale.px }} />
          {scale.label}
        </span>
      )}
      <span className="status-cell"><b>WGS 84</b></span>
      <span className="status-credits">
        {dataThrough ? `Record through ${formatDate(dataThrough)} · ` : ''}
        Fire data: NASA FIRMS (MODIS, VIIRS) · {BASE_CREDIT} · {PLACE_SEARCH_CREDIT}
      </span>
    </footer>
  )
}
