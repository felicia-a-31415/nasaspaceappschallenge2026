import { DataFilterExtension } from '@deck.gl/extensions'
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import { config, Map as MapLibreMap, MapMouseEvent, NavigationControl } from 'maplibre-gl'
// MapLibre parses its tiles in a web worker whose URL it builds at runtime, which no
// bundler can follow. Pointing it at the worker as an asset makes both the dev server
// and the production build serve the right file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'

import { circlePolygon, CELL_DEG } from '../lib/geo'
import type { HotspotArrays, Selection, TopArea } from '../types'
import { Z_COLOURS, Z_NORMAL_CLASS, zClass } from './anomaly'
import type { AnomalyCell } from './anomaly'
import { applyBase, BASE_STYLE, dressStyle, showGraticule, showLabels, UNDER_LABELS } from './baseMap'
import type { BaseMap } from './baseMap'
import { FRP_CLASS_COLOURS, frpClass } from './frpCells'
import type { FrpCell } from './frpCells'
import { FIELD_GONE_ZOOM } from './field'

config.WORKER_URL = workerUrl

/** Filtering by day happens on the graphics card, so the slider never rebuilds data. */
const DAY_FILTER = new DataFilterExtension({ filterSize: 1 })

/** Light added to light, so a fire that has just appeared flares before it settles. */
const ADDITIVE = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one',
} as const

const ACCENT: [number, number, number] = [108, 192, 255]

export interface MapViewProps {
  hotspots: HotspotArrays | null
  /** First and last visible day, in days since the hotspot epoch. */
  dayRange: [number, number]
  /** Inside this the dots are drawn in full; between it and `dayRange` they fade out. */
  softRange: [number, number] | null
  /** ΣFRP per 0.1° cell for the period, drawn as classed cells when zoomed out. Null draws markers only. */
  cells: FrpCell[] | null
  /**
   * While playing: the days just behind the playhead. Detections in them are drawn again,
   * larger and brighter, fading as they age, so the eye follows where fire is new.
   */
  flare: [number, number] | null
  /** Encoding B: cells to draw by standardized anomaly. Null draws detections by FRP. */
  anomaly: AnomalyCell[] | null
  base: BaseMap
  graticule: boolean
  labels: boolean
  selection: Selection | null
  topAreas: TopArea[]
  onMapClick: (lat: number, lon: number) => void
  onMapReady?: (map: MapLibreMap) => void
}

export function MapView({
  hotspots, dayRange, softRange, cells, flare, anomaly, base, graticule, labels, selection, topAreas, onMapClick, onMapReady,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapLibreOverlay | null>(null)
  const hotspotsRef = useRef<HotspotArrays | null>(null)
  const clickRef = useRef(onMapClick)

  const [zoom, setZoom] = useState(4)
  /** The style has loaded and the relief, imagery and grid have been added to it. */
  const [ready, setReady] = useState(false)

  hotspotsRef.current = hotspots
  clickRef.current = onMapClick

  // The zoom decides whether cells or individual detections are drawn.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const read = () => setZoom(Math.round(map.getZoom() * 10) / 10)
    read()
    map.on('zoom', read)
    return () => { map.off('zoom', read) }
    // The map exists once the style is ready; before that there is nothing to listen to.
  }, [ready])

  // One dot per hotspot, as buffers the card can keep.
  const binary = useMemo(() => (hotspots
    ? {
      length: hotspots.count,
      attributes: {
        getPosition: { value: hotspots.positions, size: 2 },
        getFillColor: { value: hotspots.colors, size: 3, normalized: true },
        getRadius: { value: hotspots.radius, size: 1 },
        getFilterValue: { value: hotspots.day, size: 1 },
      },
    }
    : null), [hotspots])

  // The same detections with no colour of their own, for under the anomaly cells.
  const plain = useMemo(() => (binary
    ? { length: binary.length, attributes: { getPosition: binary.attributes.getPosition, getFilterValue: binary.attributes.getFilterValue } }
    : null), [binary])

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = new MapLibreMap({
      container: container.current,
      style: BASE_STYLE,
      bounds: [-79.8, 44.9, -57.1, 62.6], // Quebec, from the hotspot bounding box.
      fitBoundsOptions: { padding: 24 },
      // Added below instead, so it sits with the other controls, clear of the time bar.
      attributionControl: false,
      canvasContextAttributes: {
        // Needed so the animation can be recorded from the canvas (F9).
        preserveDrawingBuffer: true,
        antialias: true,
      },
    })
    // The scale, the position under the pointer and the credits are in the status bar.
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-left')
    map.once('load', () => {
      dressStyle(map)
      setReady(true)
    })
    map.on('click', (e: MapMouseEvent) => clickRef.current(Number(e.lngLat.lat.toFixed(4)), Number(e.lngLat.lng.toFixed(4))))

    const overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
      getTooltip: ({ index, layer, object }) => {
        const h = hotspotsRef.current
        const row = (name: string, value: string) => `<tr><th>${name}</th><td>${value}</td></tr>`
        const style = { background: 'none', color: 'inherit', padding: '0', font: 'inherit' }
        if (layer?.id === 'frp-cells' && object) {
          const cell = object as FrpCell
          return {
            className: 'probe',
            html: `<strong>Cell ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}°</strong><table>`
              + row('ΣFRP', `${Math.round(cell.sumFrp).toLocaleString('en-CA')} MW`)
              + row('n', `${cell.detections.toLocaleString('en-CA')} detections`)
              + row('Mean', `${(cell.sumFrp / cell.detections).toFixed(1)} MW`)
              + '</table>',
            style,
          }
        }
        if (layer?.id === 'anomaly-cells' && object) {
          const cell = object as AnomalyCell
          return {
            className: 'probe',
            html: `<strong>Cell ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}°</strong><table>`
              + row('z', `${cell.z >= 0 ? '+' : '−'}${Math.abs(cell.z).toFixed(2)}`)
              + row('x', `${cell.x} fire-days`)
              + row('μ', cell.mean.toFixed(2))
              + row('σ', cell.sd.toFixed(2))
              + '</table>',
            style,
          }
        }
        if (!h || index < 0 || !layer?.id.startsWith('hotspots')) return null
        const older = h.sensor[index] === 0
        const lat = h.positions[index * 2 + 1]
        const lon = h.positions[index * 2]
        return {
          className: 'probe',
          html: `<strong>${dateFromDay(h, index)}</strong><table>`
            + row('FRP', `${h.frp[index].toFixed(1)} MW`)
            + row('Position', `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(4)}°${lon < 0 ? 'W' : 'E'}`)
            + row('Sensor', older ? 'MODIS C6.1 · 1 km' : 'VIIRS C2 · 375 m')
            + '</table>',
          // The look is in the stylesheet, with everything else.
          style,
        }
      },
    })
    map.addControl(overlay)
    mapRef.current = map
    overlayRef.current = overlay
    onMapReady?.(map)

    return () => {
      map.remove()
      setReady(false)
      mapRef.current = null
      overlayRef.current = null
    }
    // Created once; everything else arrives through setProps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    applyBase(map, base)
    showGraticule(map, graticule)
    showLabels(map, labels)
  }, [ready, base, graticule, labels])

  useEffect(() => {
    const overlay = overlayRef.current
    // The data sits under the map's names, so it waits for the style that holds them.
    if (!overlay || !ready) return

    const grain = Math.min(1, Math.max(0.42, 0.42 + (zoom - 4) * 0.2))
    const half = CELL_DEG / 2
    const square = (c: { lat: number; lon: number }): [number, number][] => [
      [c.lon - half, c.lat - half], [c.lon + half, c.lat - half],
      [c.lon + half, c.lat + half], [c.lon - half, c.lat + half],
    ]
    // Below this zoom a detection is smaller than a pixel; the grid cell is the honest unit.
    const gridded = cells !== null && zoom < FIELD_GONE_ZOOM
    const layers = []
    if (gridded && !anomaly) {
      layers.push(new PolygonLayer<FrpCell>({
        id: 'frp-cells',
        ...({ beforeId: UNDER_LABELS } as object),
        data: cells,
        getPolygon: square,
        filled: true,
        getFillColor: (c) => [...FRP_CLASS_COLOURS[frpClass(c.sumFrp)], 235],
        stroked: zoom >= 5.5,
        getLineColor: [6, 9, 11, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 0.5,
        pickable: true,
      }))
    }
    if (anomaly && plain) {
      layers.push(new PolygonLayer<AnomalyCell>({
        id: 'anomaly-cells',
        // Deck's own layer types do not list the MapLibre slot a layer is drawn in.
        ...({ beforeId: UNDER_LABELS } as object),
        data: anomaly,
        getPolygon: square,
        filled: true,
        stroked: zoom >= 5.5,
        getLineColor: [6, 9, 11, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 0.5,
        // Normal cells recede; departures either way are drawn firmly.
        getFillColor: (c) => {
          const k = zClass(c.z)
          return [...Z_COLOURS[k], k === Z_NORMAL_CLASS ? 38 : 225]
        },
        pickable: true,
      }))
      // Zoomed in, the detections themselves, uncoloured, so a cell can be checked against them.
      if (zoom >= FIELD_GONE_ZOOM) layers.push(new ScatterplotLayer({
        id: 'hotspots-plain',
        beforeId: UNDER_LABELS,
        data: plain,
        radiusUnits: 'pixels',
        getRadius: 1.4,
        radiusScale: grain,
        radiusMinPixels: 0.7,
        getFillColor: [240, 242, 244],
        stroked: false,
        pickable: true,
        opacity: 0.55,
        extensions: [DAY_FILTER],
        filterRange: dayRange,
      }))
    } else if (binary && !gridded) {
      layers.push(new ScatterplotLayer({
        id: 'hotspots',
        beforeId: UNDER_LABELS,
        data: binary,
        radiusUnits: 'pixels',
        // Zoomed out, the dots shrink to a fine grain rather than piling into blobs.
        radiusScale: grain,
        radiusMinPixels: 0.9,
        radiusMaxPixels: 14,
        // A vector marker: a filled disc with a dark keyline, so neighbours stay distinct.
        stroked: zoom >= 6.5,
        getLineColor: [6, 9, 11, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 0.6,
        pickable: true,
        opacity: 1,
        extensions: [DAY_FILTER],
        filterRange: dayRange,
        filterSoftRange: softRange,
      }))
    }
    if (binary && flare && !anomaly) {
      const [oldest, newest] = flare
      layers.push(new ScatterplotLayer({
        id: 'hotspots-fresh',
        beforeId: UNDER_LABELS,
        data: binary,
        radiusUnits: 'pixels',
        radiusScale: grain * 1.9,
        radiusMinPixels: 1.6,
        radiusMaxPixels: 12,
        stroked: false,
        pickable: false,
        opacity: 0.38,
        extensions: [DAY_FILTER],
        filterRange: [oldest, newest],
        filterSoftRange: [newest - (newest - oldest) * 0.2, newest],
        parameters: ADDITIVE,
      }))
    }

    // Ten 0.1° outlines are a smudge until the map is close enough to tell them apart.
    if (topAreas.length && zoom >= 5.2) {
      layers.push(new PolygonLayer<TopArea>({
        id: 'top-areas',
        data: topAreas,
        getPolygon: (a) => squareAround(a.lat, a.lon),
        filled: false,
        stroked: true,
        getLineColor: [246, 243, 238, 210],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        pickable: false,
      }))
      layers.push(new TextLayer<TopArea>({
        id: 'top-area-ranks',
        data: topAreas,
        getPosition: (a) => [a.lon, a.lat + CELL_DEG * 0.7],
        getText: (a) => String(topAreas.indexOf(a) + 1),
        getSize: 13,
        getColor: [246, 243, 238, 245],
        outlineColor: [8, 8, 12, 255],
        outlineWidth: 3,
        fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16 },
        pickable: false,
      }))
    }

    if (selection) {
      layers.push(new PolygonLayer<Selection>({
        id: 'selection-circle',
        data: [selection],
        getPolygon: (s) => circlePolygon(s.lat, s.lon, s.radius_km),
        filled: true,
        getFillColor: [...ACCENT, 10],
        stroked: true,
        getLineColor: [...ACCENT, 240],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
      }))
      // The circle states its own size, where it is drawn.
      layers.push(new TextLayer<Selection>({
        id: 'selection-radius',
        data: [selection],
        getPosition: (s) => [s.lon, s.lat + s.radius_km / 111.32],
        getText: (s) => `R ${s.radius_km} km`,
        getSize: 11,
        getPixelOffset: [0, -11],
        getColor: [...ACCENT, 255],
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontWeight: 500,
        outlineColor: [4, 7, 9, 255],
        outlineWidth: 4,
        fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16 },
        pickable: false,
      }))
      layers.push(new ScatterplotLayer<Selection>({
        id: 'selection-centre',
        data: [selection],
        getPosition: (s) => [s.lon, s.lat],
        radiusUnits: 'pixels',
        getRadius: 4,
        filled: true,
        getFillColor: [...ACCENT, 255],
        stroked: true,
        getLineColor: [10, 10, 14, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
      }))
    }

    overlay.setProps({ layers })
  }, [ready, binary, cells, zoom, dayRange, softRange, flare, anomaly, plain, selection, topAreas])

  return <div ref={container} className="map" role="application" aria-label="Map of fire detections in Quebec" />
}

function dateFromDay(h: HotspotArrays, index: number): string {
  const ms = Date.parse(h.epoch + 'T00:00:00Z') + h.day[index] * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** The 10 km square a top area names, as a ring. */
function squareAround(lat: number, lon: number): [number, number][] {
  const half = CELL_DEG / 2
  return [
    [lon - half, lat - half], [lon + half, lat - half],
    [lon + half, lat + half], [lon - half, lat + half],
    [lon - half, lat - half],
  ]
}
