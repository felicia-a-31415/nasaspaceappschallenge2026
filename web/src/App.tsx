import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { getAbout, getTopAreas, getWeather } from './api'
import { CalendarView } from './components/CalendarView'
import { CopyLink } from './components/CopyLink'
import { Legend } from './components/Legend'
import { MapControls } from './components/MapControls'
import type { MapLayers } from './components/MapControls'
import { Method } from './components/Method'
import { DayStrip } from './components/ops/DayStrip'
import { OpsKey } from './components/ops/OpsKey'
import { OpsPanel } from './components/ops/OpsPanel'
import { Share } from './components/ops/Share'
import { Panel } from './components/Panel'
import { SearchBox } from './components/SearchBox'
import { StatusBar } from './components/StatusBar'
import { TimeBar } from './components/TimeBar'
import { useHotspots } from './hooks/useHotspots'
import { usePanel } from './hooks/usePanel'
import { useSelectionQuery } from './hooks/useSelectionQuery'
import { useSituation } from './hooks/useSituation'
import { useTimeline } from './hooks/useTimeline'
import { useView } from './hooks/useView'
import { nameNear } from './places'
import { dayToDate, formatDate } from './lib/days'
import { count } from './lib/format'
import { circlePolygon } from './lib/geo'
import { computeAnomaly } from './map/anomaly'
import { sliceByDay } from './map/field'
import { frpCells } from './map/frpCells'
import { MapView } from './map/MapView'
import type { AboutResponse, Selection, TopArea } from './types'
import { isDefaultView, RADII_KM } from './view'
import type { Mode } from './view'

const WEATHER_MONTHS = 36

/** A stable empty list, so the map is not handed a new array on every render. */
const EMPTY_AREAS: TopArea[] = []

/** Quebec, from the hotspot bounding box: west, south, east, north. */
const QUEBEC: [number, number, number, number] = [-79.8, 44.9, -57.1, 62.6]

/** Room to leave around a framed place so the sheet and the time line do not cover it. */
function clearOfChrome(margin = 48) {
  const css = getComputedStyle(document.documentElement)
  const px = (name: string) => parseFloat(css.getPropertyValue(name)) || 0
  const narrow = window.innerWidth <= 880
  return {
    top: margin,
    bottom: (narrow ? 0 : px('--timebar-h') + 12) + margin,
    left: (narrow ? 0 : px('--card-w') + 24) + margin,
    right: margin,
  }
}

type Workspace = 'map' | 'calendar'

const WORKSPACES: { id: Workspace; label: string }[] = [
  { id: 'map', label: 'Spatial map' },
  { id: 'calendar', label: 'Activity calendar' },
]

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'record', label: 'Full record' },
  { mode: 'shift', label: 'Operational' },
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
  const [layers, setLayers] = useState<MapLayers>({
    base: 'terrain', encoding: 'frp', field: true, flare: false, graticule: true, labels: true, squares: true,
  })
  /** The spatial map is the default workflow; the calendar is the temporal one. */
  const [workspace, setWorkspace] = useState<Workspace>('map')
  /** Full-screen map: the surrounding panels are hidden, the layer controls and readouts stay. */
  const [fullMap, setFullMap] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const changeLayers = useCallback((change: Partial<MapLayers>) => setLayers((now) => ({ ...now, ...change })), [])
  /** The map, once it exists, for the things that read it directly. */
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [method, setMethod] = useState(false)
  const closeMethod = useCallback(() => setMethod(false), [])
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    if (!fullMap) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullMap(false) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [fullMap])

  useEffect(() => {
    const controller = new AbortController()
    getAbout(controller.signal).then(setAbout).catch(() => setAbout(null))
    return () => controller.abort()
  }, [])

  const { months, monthRange } = timeline
  const fromMonth = months[monthRange[0]]
  const toMonth = months[monthRange[1]]
  const { lat, lon, radius_km: radiusKm } = view

  const selection: Selection | null = useMemo(() => (lat !== null && lon !== null && fromMonth
    ? { lat, lon, radius_km: radiusKm, from: fromMonth, to: toMonth }
    : null), [lat, lon, radiusKm, fromMonth, toMonth])

  const shift = view.mode === 'shift'
  /** The situation board, when it is the view on screen. */
  const ops = useSituation(data, view)
  // The record's own questions are not asked while the board is up.
  const panel = usePanel(shift ? null : selection)

  // The hardest-hit squares depend on the months alone, not on the circle.
  const range = useMemo(
    () => (fromMonth && !shift ? { from: fromMonth, to: toMonth, limit: 10 } : null),
    [fromMonth, toMonth, shift],
  )
  const topAreas = useSelectionQuery(range, (key, signal) => getTopAreas(key, signal))
  // Daily weather over a 26-year range would be a huge request for little gain, so the
  // strip covers at most the last three years of the chosen period and says so.
  const weatherFor = useMemo(() => {
    if (!selection || !months.length || shift) return null
    const start = Math.max(monthRange[0], monthRange[1] - (WEATHER_MONTHS - 1))
    return { ...selection, from: months[start] }
  }, [selection, months, monthRange, shift])
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

  const setMode = (mode: Mode) => {
    if (mode === view.mode) return
    // The board is read on one day; a run through the record would carry on under it.
    if (mode === 'shift' && timeline.playing) timeline.pause()
    setView({ mode })
  }
  const setDay = useCallback((on: string | null) => setView({ on }), [setView])

  // While playing, the days just behind the playhead flare: about three quarters of a
  // second of the run, however long the period it covers.
  const flare: [number, number] | null = layers.flare && timeline.playing && timeline.run
    ? [timeline.head - Math.max(20, (timeline.run.toDay - timeline.run.fromDay) / 45), timeline.head]
    : null

  // Encoding B is worked out for the period at rest, never frame by frame.
  const anomaly = useMemo(
    () => (data && fromMonth && !shift && layers.encoding === 'anomaly' ? computeAnomaly(data, fromMonth, toMonth) : null),
    [data, fromMonth, toMonth, layers.encoding, shift],
  )
  const anomalyShown = anomaly?.ok && !timeline.playing ? anomaly.cells : null

  // ΣFRP cells are aggregated for the period at rest; playback draws detections.
  const [restFrom, restTo] = timeline.dayRange
  const frpGrid = useMemo(
    () => (data && !shift && layers.field && layers.encoding === 'frp' && !timeline.playing ? frpCells(data, restFrom, restTo) : null),
    [data, shift, layers.field, layers.encoding, timeline.playing, restFrom, restTo],
  )

  const getCanvas = useCallback(() => mapRef.current?.getCanvas() ?? null, [])

  /** A day picked on the calendar: show its month on the map. */
  const openMonth = (date: string) => {
    if (timeline.playing) timeline.pause()
    const month = date.slice(0, 7)
    setView({ from: month, to: month })
    setWorkspace('map')
  }

  // A clicked point has no name yet: look one up ("38 km NW of Chibougamau").
  const [found, setFound] = useState<{ lat: number; lon: number; name: string } | null>(null)
  const searched = named && named.lat === lat && named.lon === lon ? named.name : null
  useEffect(() => {
    if (lat === null || lon === null || searched) return
    let live = true
    void nameNear(lat, lon).then((name) => { if (live && name) setFound({ lat, lon, name }) })
    return () => { live = false }
  }, [lat, lon, searched])
  const placeName = searched ?? (found && found.lat === lat && found.lon === lon ? found.name : null)
  const radii = about?.radii_km ?? RADII_KM

  const recency = useMemo(
    () => (ops ? { fromDay: ops.fromDay, asOfDay: ops.asOfDay } : null),
    // The two days are all the map reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ops?.fromDay, ops?.asOfDay],
  )
  const opsShown = data && ops ? sliceByDay(data.day, ops.fromDay, ops.asOfDay) : null
  const calendar = workspace === 'calendar' && !shift

  return (
    <div className={`app mode-${view.mode} view-${calendar ? 'calendar' : 'map'} ${fullMap ? 'is-fullmap' : ''}`}>
      <main className="stage">
        <MapView
          hotspots={data}
          dayRange={timeline.dayRange}
          softRange={null}
          cells={frpGrid}
          flare={shift ? null : flare}
          anomaly={anomalyShown}
          recency={recency}
          base={layers.base}
          graticule={layers.graticule}
          labels={layers.labels}
          selection={selection}
          topAreas={!layers.squares ? EMPTY_AREAS : ops ? ops.areas : areas}
          onMapClick={(atLat, atLon) => {
            setView({ lat: atLat, lon: atLon })
            setNamed(null)
          }}
          onMapReady={(made) => {
            mapRef.current = made
            setMap(made)
            // Opened from a link: go straight to its area.
            if (lat !== null && lon !== null) frame(lat, lon, radiusKm, 0)
            // Otherwise show the whole region.
            else made.fitBounds(QUEBEC, { padding: clearOfChrome(16), duration: 0 })
          }}
        />

        {data && calendar && fromMonth && (
          <CalendarView
            hotspots={data}
            selection={selection}
            placeName={placeName}
            encoding={layers.encoding}
            from={fromMonth}
            to={toMonth}
            onPick={openMonth}
          />
        )}
      </main>

      {shift && data && ops && (
        <DayStrip
          hotspots={data}
          asOfDay={ops.asOfDay}
          year={ops.year}
          local={ops.board.local}
          shown={opsShown ? opsShown[1] - opsShown[0] : 0}
          onDay={setDay}
        />
      )}

      {shift && data && <OpsKey squares={layers.squares} />}

      <aside className={`side ${panel.pending ? 'is-pending' : ''}`} aria-label="Inspector">
        <header className="sheet-head">
          <div className="brand">
            <h1>ITSS</h1>
            <span>Is There Seriously Smoke?</span>
          </div>
          <SearchBox onFound={choose} />
          <div className="seg seg-fill" role="group" aria-label="View">
            {MODES.map(({ mode, label }) => (
              <button key={mode} type="button" aria-pressed={view.mode === mode} onClick={() => setMode(mode)}>{label}</button>
            ))}
          </div>
          {!shift && (
            <div className="seg seg-fill" role="group" aria-label="Workspace">
              {WORKSPACES.map(({ id, label }) => (
                <button key={id} type="button" aria-pressed={workspace === id} onClick={() => setWorkspace(id)}>{label}</button>
              ))}
            </div>
          )}
          {shift && data && ops
            ? (
              // The one caveat every figure below depends on: which day, and how current it is.
              <p className={`ops-status ${ops.latest ? '' : 'is-past'}`} role="status">
                {ops.latest
                  ? `Latest data: ${formatDate(data.dataThrough)}. Not a live feed.`
                  : `Showing a past day. Latest data is ${formatDate(data.dataThrough)}.`}
              </p>
            )
            : (
              <p className="telemetry">
                {data ? `${count(data.count)} detections · ${dayToDate(data.epoch, data.minDay)} → ${dataThrough ?? ''}` : 'Loading archive'}
              </p>
            )}
        </header>
        <div className="side-scroll">
          {shift && data && ops && (
            <OpsPanel
              view={view}
              hotspots={data}
              state={ops}
              placeName={placeName}
              radii={radii}
              onRadius={chooseRadius}
              onPick={choose}
              onClear={() => setView({ lat: null, lon: null })}
              onMethod={() => setMethod(true)}
            />
          )}
          {!shift && <Panel
            view={view}
            selection={selection}
            placeName={placeName}
            panel={panel}
            weather={weather}
            topAreas={topAreas}
            about={about}
            hotspots={data}
            dataThrough={dataThrough}
            onPick={choose}
            onMethod={() => setMethod(true)}
            getCanvas={getCanvas}
          />}
        </div>
        <footer className="sheet-foot">
          {shift && data && ops
            ? <Share view={view} hotspots={data} state={ops} placeName={placeName} getCanvas={getCanvas} />
            : (
              <>
                <CopyLink view={view} />
                <button type="button" onClick={() => setMethod(true)}>Method</button>
              </>
            )}
        </footer>
      </aside>

      <div className="tools">
        <div className="tools-row">
          {!shift && <div className="seg" role="group" aria-label="Colour encoding">
            <button type="button" aria-pressed={layers.encoding === 'frp'} onClick={() => changeLayers({ encoding: 'frp' })} title="Fire radiative power, MW">FRP</button>
            <button type="button" aria-pressed={layers.encoding === 'anomaly'} onClick={() => changeLayers({ encoding: 'anomaly' })} title="Standardized anomaly, z">Anomaly z</button>
          </div>}
          <button type="button" aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}>Layers</button>
          {!calendar && (
            <button
              type="button"
              onClick={() => setFullMap((on) => !on)}
              aria-pressed={fullMap}
              title={fullMap ? 'Exit full-screen map (Esc)' : 'Full-screen map'}
            >
              {fullMap ? 'Exit full screen' : 'Full screen'}
            </button>
          )}
        </div>
        {layersOpen && (
          <MapControls layers={layers} onLayers={changeLayers} radii={radii} radiusKm={radiusKm} onRadius={chooseRadius} board={shift} />
        )}
      </div>

      {data && !calendar && !shift && (
        <Legend map={map} encoding={layers.encoding} anomaly={timeline.playing ? null : anomaly} cells={frpGrid !== null} />
      )}

      {data && !shift && <TimeBar timeline={timeline} hotspots={data} dataThrough={dataThrough} getCanvas={getCanvas} />}

      <StatusBar map={map} />

      {method && <Method about={about} onClose={closeMethod} />}

      {hotspots.status === 'loading' && (
        <div className="curtain">
          <div className="curtain-card surface">
            <div className="spinner" />
            <h2>Loading detection archive</h2>
            <p className="muted small">MODIS C6.1 + VIIRS C2, 2000-11 to present. One request.</p>
          </div>
        </div>
      )}

      {hotspots.status === 'error' && (
        <div className="curtain">
          <div className="curtain-card surface" role="alert">
            <h2>Detection archive failed to load</h2>
            <p className="muted small">{hotspots.detail}</p>
          </div>
        </div>
      )}
    </div>
  )
}
