import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { getAbout } from './api'
import { Legend } from './components/Legend'
import { SearchBox } from './components/SearchBox'
import { StatsPanel } from './components/StatsPanel'
import { TimeBar } from './components/TimeBar'
import { useHotspots } from './hooks/useHotspots'
import { useTimeline } from './hooks/useTimeline'
import { circlePolygon } from './lib/geo'
import { MapView } from './map/MapView'
import type { AboutResponse, Selection } from './types'

const DEFAULT_RADII = [50, 100, 200]

interface Point {
  lat: number
  lon: number
  /** The place's name when it came from a search, otherwise null. */
  name: string | null
}

export default function App() {
  const hotspots = useHotspots()
  const data = hotspots.status === 'ready' ? hotspots.data : null
  const timeline = useTimeline(data)

  const [about, setAbout] = useState<AboutResponse | null>(null)
  const [point, setPoint] = useState<Point | null>(null)
  const [radiusKm, setRadiusKm] = useState(100)
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getAbout(controller.signal).then(setAbout).catch(() => setAbout(null))
    return () => controller.abort()
  }, [])

  const { months, monthRange } = timeline
  const selection: Selection | null = useMemo(() => (point
    ? {
      lat: point.lat,
      lon: point.lon,
      radius_km: radiusKm,
      from: months[monthRange[0]],
      to: months[monthRange[1]],
    }
    : null), [point, radiusKm, months, monthRange])

  /** Show the whole circle, whatever its size. */
  const frame = useCallback((lat: number, lon: number, km: number) => {
    const map = mapRef.current
    if (!map) return
    const ring = circlePolygon(lat, lon, km, 32)
    const lons = ring.map(([x]) => x)
    const lats = ring.map(([, y]) => y)
    map.fitBounds(
      [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
      { padding: 80, duration: 1200 },
    )
  }, [])

  const choose = useCallback((lat: number, lon: number, name: string | null) => {
    setPoint({ lat, lon, name })
    frame(lat, lon, radiusKm)
  }, [frame, radiusKm])

  const chooseRadius = useCallback((km: number) => {
    setRadiusKm(km)
    if (point) frame(point.lat, point.lon, km)
  }, [frame, point])

  const dataThrough = about?.data_through ?? data?.dataThrough

  return (
    <div className="app">
      <MapView
        hotspots={data}
        dayRange={timeline.dayRange}
        selection={selection}
        topAreas={[]}
        onMapClick={(lat, lon) => setPoint({ lat, lon, name: null })}
        onMapReady={(map) => { mapRef.current = map }}
      />

      <div className="topbar">
        <div className="brand panel-surface">
          <h1>Quebec fire record</h1>
          <p>Every fire detection since 2000, corrected so the two satellite cameras can be compared</p>
        </div>
        <SearchBox
          radii={about?.radii_km ?? DEFAULT_RADII}
          radiusKm={radiusKm}
          onRadius={chooseRadius}
          onFound={choose}
        />
      </div>

      <aside className="side panel-surface">
        {selection
          ? <StatsPanel selection={selection} placeName={point?.name ?? null} />
          : (
            <div className="prompt">
              <h2>Pick a place</h2>
              <p className="muted small">
                Search for a town or type coordinates, or click anywhere on the map. The
                numbers for the circle you choose appear here.
              </p>
              <p className="muted small">
                The map behind shows every fire detection in Quebec since November 2000,
                playing through time. Pause whenever you like.
              </p>
            </div>
          )}
      </aside>

      {data && <Legend dataThrough={dataThrough} />}
      {data && <TimeBar timeline={timeline} epoch={data.epoch} />}

      {hotspots.status === 'loading' && (
        <div className="curtain">
          <div className="curtain-card panel-surface">
            <div className="spinner" />
            <h2>Loading the fire record</h2>
            <p className="muted small">About 723,000 fire detections across Quebec. This happens once.</p>
          </div>
        </div>
      )}

      {hotspots.status === 'error' && (
        <div className="curtain">
          <div className="curtain-card panel-surface" role="alert">
            <h2>The fire data did not load</h2>
            <p className="muted small">{hotspots.detail}</p>
          </div>
        </div>
      )}
    </div>
  )
}
