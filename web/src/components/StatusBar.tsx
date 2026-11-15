import { useEffect, useState } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

import { BASE_CREDIT } from '../map/baseMap'
import { PLACE_SEARCH_CREDIT } from '../places'
import { HowMade } from './HowMade'

export interface StatusBarProps {
  map: MapLibreMap | null
}

function angle(value: number, positive: string, negative: string, width: number): string {
  return `${Math.abs(value).toFixed(4).padStart(width, '0')}°${value < 0 ? negative : positive}`
}

/**
 * The strip along the bottom edge: where the pointer is, and where the data and the map
 * come from. It listens to the map itself, so moving the
 * pointer redraws this strip and nothing else.
 */
export function StatusBar({ map }: StatusBarProps) {
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null)

  useEffect(() => {
    if (!map) return
    const move = (event: MapMouseEvent) => setCursor({ lat: event.lngLat.lat, lon: event.lngLat.lng })
    const leave = () => setCursor(null)
    map.on('mousemove', move)
    map.on('mouseout', leave)
    return () => {
      map.off('mousemove', move)
      map.off('mouseout', leave)
    }
  }, [map])

  return (
    <footer className="statusbar">
      <span className="status-cell status-cursor" aria-hidden="true">
        <b>LAT</b> {cursor ? angle(cursor.lat, 'N', 'S', 7) : '––.––––°'}
        <b>LON</b> {cursor ? angle(cursor.lon, 'E', 'W', 8) : '––.––––°'}
      </span>
      <span className="status-credits">
        Fire data: NASA FIRMS (MODIS, VIIRS) · {BASE_CREDIT} · {PLACE_SEARCH_CREDIT}
      </span>
      <HowMade />
    </footer>
  )
}
