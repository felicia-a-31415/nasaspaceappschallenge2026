import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { getAbout, getTopAreas, getWeather } from './api'
import { CopyLink } from './components/CopyLink'
import { Legend } from './components/Legend'
import { Panel } from './components/Panel'
import { SearchBox } from './components/SearchBox'
import { TimeBar } from './components/TimeBar'
import { useHotspots } from './hooks/useHotspots'
import { usePanel } from './hooks/usePanel'
import { useSelectionQuery } from './hooks/useSelectionQuery'
import { useTimeline } from './hooks/useTimeline'
import { useView } from './hooks/useView'
import { circlePolygon } from './lib/geo'
import { MapView } from './map/MapView'
import type { AboutResponse, Selection, TopArea } from './types'
import { isDefaultView, RADII_KM } from './view'
import type { Mode } from './view'

const WEATHER_MONTHS = 36

/** A stable empty list, so the map is not handed a new array on every render. */
const EMPTY_AREAS: TopArea[] = []

/** Quebec, from the hotspot bounding box: west, south, east, north. */
const QUEBEC: [number, number, number, number] = [-79.8, 44.9, -57.1, 62.6]

/** Room to leave around a framed place so the header, panel and time line do not cover it. */
function clearOfChrome(margin = 48) {
  const css = getComputedStyle(document.documentElement)
  const px = (name: string) => parseFloat(css.getPropertyValue(name)) || 0
  const narrow = window.innerWidth <= 880
  return {
    top: 64 + margin,
    bottom: px('--timebar-h') + 12 + margin,
    left: margin,
    right: (narrow ? 0 : px('--card-w') + 12) + margin,
  }
}

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'record', label: 'Full record' },
  { mode: 'shift', label: 'On shift' },
]

export default function App() {
  const hotspots = useHotspots()
  const data = hotspots.status === 'ready' ? hotspots.data : null

  // The view is the one description of what the page shows: place, circle, period, mode.
  // It lives in the address, so a link restores it. Everything below reads it from here.
  const [view, setView] = useView()
  // A plain address plays the record. A link that names a view is shown as it is.
  const [openedPlain] = useState(() => isDefaultView(view))

  const onRange = useCallback((from: string | null, to: string | null) => setView({ from, to }), [setView])
  const timeline = useTimeline(data, { from: view.from, to: view.to, onRange, autoPlay: openedPlain })

  const [about, setAbout] = useState<AboutResponse | null>(null)
  /** The name a search gave the chosen place. A link carries coordinates only. */
  const [named, setNamed] = useState<{ lat: number; lon: number; name: string } | null>(null)
  const [field, setField] = useState(true)
  /** The card starts small: the place, the corrected sentence, two figures. */
  const [expanded, setExpanded] = useState(false)
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getAbout(controller.signal).then(setAbout).catch(() => setAbout(null))
    return () => controller.abort()
  }, [])

  const { months, monthRange, recordLast } = timeline
  const fromMonth = months[monthRange[0]]
  const toMonth = months[monthRange[1]]
  const { lat, lon, radius_km: radiusKm } = view

  const selection: Selection | null = useMemo(() => (lat !== null && lon !== null && fromMonth
    ? { lat, lon, radius_km: radiusKm, from: fromMonth, to: toMonth }
    : null), [lat, lon, radiusKm, fromMonth, toMonth])

  const panel = usePanel(selection)

  // The hardest-hit squares depend on the months alone, not on the circle.
  const range = useMemo(
    () => (fromMonth ? { from: fromMonth, to: toMonth, limit: 10 } : null),
    [fromMonth, toMonth],
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
  const areas = topAreas.status === 'ready' ? topAreas.data.areas : EMPTY_AREAS

  /** Show the whole circle, whatever its size. */
  const frame = useCallback((atLat: number, atLon: number, km: number, duration = 1200) => {
    const map = mapRef.current
    if (!map) return
    const ring = circlePolygon(atLat, atLon, km, 32)
    const lons = ring.map(([x]) => x)
    const lats = ring.map(([, y]) => y)
    map.fitBounds(
      [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
      { padding: clearOfChrome(), duration },
    )
  }, [])

  const choose = useCallback((atLat: number, atLon: number, name: string | null) => {
    setView({ lat: atLat, lon: atLon })
    setNamed(name ? { lat: atLat, lon: atLon, name } : null)
    frame(atLat, atLon, radiusKm)
  }, [frame, radiusKm, setView])

  const chooseRadius = useCallback((km: number) => {
    setView({ radius_km: km })
    if (lat !== null && lon !== null) frame(lat, lon, km)
  }, [frame, lat, lon, setView])

  const dataThrough = about?.data_through ?? data?.dataThrough

  // Quick periods for someone on shift, all counted back from the end of the record.
  const presets = useMemo(() => {
    if (!months.length) return []
    const lastMonth = months[recordLast]
    const options = [
      { label: 'Last 3 months', from: months[Math.max(0, recordLast - 2)] },
      { label: `${lastMonth.slice(0, 4)} so far`, from: months.find((m) => m.startsWith(lastMonth.slice(0, 4))) ?? lastMonth },
      { label: 'Last 12 months', from: months[Math.max(0, recordLast - 11)] },
    ]
    return options.map((option) => ({
      label: option.label,
      active: fromMonth === option.from && monthRange[1] === recordLast,
      pick: () => {
        if (timeline.playing) timeline.pause()
        setView({ from: option.from, to: null })
      },
    }))
    // `timeline` is a new object every frame while playing; its parts are named instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, recordLast, fromMonth, monthRange, timeline.playing, timeline.pause, setView])

  const setMode = (mode: Mode) => {
    if (mode === view.mode) return
    if (mode === 'shift') {
      // On shift, the recent past comes first: this year up to the end of the record.
      if (timeline.playing) timeline.pause()
      const lastMonth = months[recordLast]
      const from = lastMonth ? months.find((m) => m.startsWith(lastMonth.slice(0, 4))) ?? null : null
      setView({ mode, from, to: null })
    } else {
      setView({ mode })
    }
  }

  const placeName = named && named.lat === lat && named.lon === lon ? named.name : null
  const radii = about?.radii_km ?? RADII_KM

  return (
    <div className={`app mode-${view.mode}`}>
      <MapView
        hotspots={data}
        dayRange={timeline.dayRange}
        softRange={null}
        showField={field && !timeline.playing}
        selection={selection}
        topAreas={areas}
        onMapClick={(atLat, atLon) => {
          setView({ lat: atLat, lon: atLon })
          setNamed(null)
        }}
        onMapReady={(map) => {
          mapRef.current = map
          // Opened from a link: go straight to its circle.
          if (lat !== null && lon !== null) frame(lat, lon, radiusKm, 0)
          // Otherwise show all of Quebec in the part of the map nothing covers.
          else map.fitBounds(QUEBEC, { padding: clearOfChrome(16), duration: 0 })
        }}
      />

      <div className="topleft">
        <SearchBox onFound={choose} />
        <div className="chips">
          <div className="seg" role="group" aria-label="Size of the circle around the place">
            {radii.map((km) => (
              <button key={km} type="button" aria-pressed={km === radiusKm} onClick={() => chooseRadius(km)}>
                {km} km
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="View">
            {MODES.map(({ mode, label }) => (
              <button key={mode} type="button" aria-pressed={view.mode === mode} onClick={() => setMode(mode)}>
                {label}
              </button>
            ))}
          </div>
          <CopyLink view={view} />
        </div>
      </div>

      {data && <Legend field={field} onField={setField} />}

      <aside
        className={`side ${expanded ? 'is-expanded' : ''} ${panel.pending ? 'is-pending' : ''}`}
        aria-label="About the chosen place"
      >
        <div className="side-scroll">
          <Panel
            view={view}
            selection={selection}
            placeName={placeName}
            panel={panel}
            weather={weather}
            topAreas={topAreas}
            dataThrough={dataThrough}
            presets={presets}
            onPick={choose}
            expanded={expanded}
          />
        </div>
        <button
          type="button"
          className="side-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          {expanded ? 'Less detail' : 'More detail'}
          <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </button>
      </aside>

      {data && (
        <TimeBar timeline={timeline} hotspots={data} dataThrough={dataThrough} getCanvas={() => mapRef.current?.getCanvas() ?? null} />
      )}

      {hotspots.status === 'loading' && (
        <div className="curtain">
          <div className="curtain-card surface">
            <div className="spinner" />
            <h2>Loading the fire record</h2>
            <p className="muted small">About 723,000 fire detections across Quebec. This happens once.</p>
          </div>
        </div>
      )}

      {hotspots.status === 'error' && (
        <div className="curtain">
          <div className="curtain-card surface" role="alert">
            <h2>The fire data did not load</h2>
            <p className="muted small">{hotspots.detail}</p>
          </div>
        </div>
      )}
    </div>
  )
}
