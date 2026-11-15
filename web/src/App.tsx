import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { getAbout, getOutlook, getTopAreas, getWeather } from './api'
import { Legend } from './components/Legend'
import { SearchBox } from './components/SearchBox'
import { StatsPanel } from './components/StatsPanel'
import { Downloads } from './components/Downloads'
import { Outlook } from './components/Outlook'
import { TopAreas } from './components/TopAreas'
import { WeatherStrip } from './components/WeatherStrip'
import { TimeBar } from './components/TimeBar'
import { useHotspots } from './hooks/useHotspots'
import { useTimeline } from './hooks/useTimeline'
import { useSelectionQuery } from './hooks/useSelectionQuery'
import { circlePolygon } from './lib/geo'
import { MapView } from './map/MapView'
import type { AboutResponse, Selection, TopArea } from './types'

const DEFAULT_RADII = [50, 100, 200]
const WEATHER_MONTHS = 36

/** A stable empty list, so the map is not handed a new array on every render. */
const EMPTY_AREAS: TopArea[] = []

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

  // The hardest-hit squares depend on the months alone, not on the circle.
  const range = useMemo(
    () => (months.length ? { from: months[monthRange[0]], to: months[monthRange[1]], limit: 10 } : null),
    [months, monthRange],
  )
  const topAreas = useSelectionQuery(range, (key, signal) => getTopAreas(key, signal))
  // Daily weather over a 26-year range would be a huge request for little gain, so the
  // strip covers at most the last three years of the chosen period and says so.
  const weatherFor = useMemo(() => {
    if (!selection || !months.length) return null
    const start = Math.max(monthRange[0], monthRange[1] - (WEATHER_MONTHS - 1))
    return { ...selection, from: months[start] }
  }, [selection, months, monthRange])
  const weather = useSelectionQuery(weatherFor, (sel, signal) => getWeather(sel, signal))
  const outlook = useSelectionQuery(selection, (sel, signal) => getOutlook(sel, signal))
  const areas = topAreas.status === 'ready' ? topAreas.data.areas : EMPTY_AREAS

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
        topAreas={areas}
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
          ? (
            <>
              <StatsPanel selection={selection} placeName={point?.name ?? null} />
              <Outlook state={outlook} />
              <WeatherStrip state={weather} />
              <Downloads selection={selection} />
              <TopAreas state={topAreas} onPick={choose} />
            </>
          )
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
              <TopAreas state={topAreas} onPick={choose} />
            </div>
          )}
      </aside>

      {data && <Legend dataThrough={dataThrough} />}
      {data && <TimeBar timeline={timeline} epoch={data.epoch} getCanvas={() => mapRef.current?.getCanvas() ?? null} />}

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
