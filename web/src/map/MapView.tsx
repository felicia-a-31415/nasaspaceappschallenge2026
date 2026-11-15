import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import { DataFilterExtension } from '@deck.gl/extensions'
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import { AttributionControl, config, Map as MapLibreMap, MapMouseEvent, NavigationControl, ScaleControl } from 'maplibre-gl'
// MapLibre parses its tiles in a web worker whose URL it builds at runtime, which no
// bundler can follow. Pointing it at the worker as an asset makes both the dev server
// and the production build serve the right file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'

import { formatDate } from '../lib/days'
import { circlePolygon, CELL_DEG } from '../lib/geo'
import type { HotspotArrays, Selection, TopArea } from '../types'
import { rampColour } from './colourRamp'
import { fieldShare, sliceByDay } from './field'

config.WORKER_URL = workerUrl

/** A free dark style that needs no key. Its attribution travels with the style. */
const BASE_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** Filtering by day happens on the graphics card, so the slider never rebuilds data. */
const DAY_FILTER = new DataFilterExtension({ filterSize: 1 })

/** The field uses the same ramp as the dots, so one legend covers both. */
const FIELD_COLOURS = Array.from({ length: 8 }, (_, i) => rampColour(i / 7))

export interface MapViewProps {
  hotspots: HotspotArrays | null
  /** First and last visible day, in days since the hotspot epoch. */
  dayRange: [number, number]
  /** Inside this the dots are drawn in full; between it and `dayRange` they fade out. */
  softRange: [number, number] | null
  /**
   * Draw fire intensity as a glow when zoomed out. Only ever asked for while the time
   * line is at rest: the dots are the layer that plays.
   */
  showField: boolean
  selection: Selection | null
  topAreas: TopArea[]
  onMapClick: (lat: number, lon: number) => void
  onMapReady?: (map: MapLibreMap) => void
}

export function MapView({ hotspots, dayRange, softRange, showField, selection, topAreas, onMapClick, onMapReady }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapLibreOverlay | null>(null)
  const hotspotsRef = useRef<HotspotArrays | null>(null)
  const clickRef = useRef(onMapClick)

  const [zoom, setZoom] = useState(4)

  hotspotsRef.current = hotspots
  clickRef.current = onMapClick

  // The glow is worked out from the hotspots in the chosen days only. They arrive in day
  // order, so a period is one unbroken stretch of the arrays: nothing is copied.
  const [firstDay, lastDay] = dayRange
  const field = useMemo(() => {
    if (!hotspots || !showField) return null
    const slice = sliceByDay(hotspots.day, firstDay, lastDay)
    if (!slice) return null
    const [start, end] = slice
    return {
      length: end - start,
      attributes: {
        getPosition: { value: hotspots.positions.subarray(start * 2, end * 2), size: 2 },
        // Weighted by intensity, never by how many detections there were: the number of
        // detections depends on which camera was flying.
        getWeight: { value: hotspots.frp.subarray(start, end), size: 1 },
      },
    }
  }, [hotspots, showField, firstDay, lastDay])

  // The zoom decides how much is glow and how much is dots.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const read = () => setZoom(Math.round(map.getZoom() * 10) / 10)
    read()
    map.on('zoom', read)
    return () => { map.off('zoom', read) }
  }, [])

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
    map.addControl(new AttributionControl({ compact: true }), 'bottom-left')
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-left')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('click', (e: MapMouseEvent) => clickRef.current(Number(e.lngLat.lat.toFixed(4)), Number(e.lngLat.lng.toFixed(4))))

    const overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
      getTooltip: ({ index, layer }) => {
        const h = hotspotsRef.current
        if (!h || index < 0 || layer?.id !== 'hotspots') return null
        const camera = h.sensor[index] === 0 ? 'older satellite camera' : 'newer satellite camera'
        return {
          html: `<strong>${formatDate(dateFromDay(h, index))}</strong><br/>`
            + `Fire intensity ${h.frp[index].toFixed(1)} megawatts<br/>`
            + `Seen by the ${camera}`,
          style: {
            background: '#0d0f12',
            color: '#ece9e2',
            font: '12.5px/1.45 "IBM Plex Sans", system-ui, sans-serif',
            padding: '7px 10px',
            borderRadius: '8px',
            border: '1px solid rgba(236,233,226,0.3)',
          },
        }
      },
    })
    map.addControl(overlay)
    mapRef.current = map
    overlayRef.current = overlay
    onMapReady?.(map)

    return () => {
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
    // Created once; everything else arrives through setProps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    const glow = field && field.length > 0 ? fieldShare(zoom) : 0
    const layers = []
    if (field && glow > 0) {
      layers.push(new HeatmapLayer({
        id: 'intensity-field',
        data: field,
        aggregation: 'SUM',
        radiusPixels: 26,
        intensity: 1.4,
        threshold: 0.03,
        colorRange: FIELD_COLOURS,
        weightsTextureSize: 1024,
        debounceTimeout: 150,
        opacity: 0.85 * glow,
        pickable: false,
      }))
    }
    if (binary) {
      layers.push(new ScatterplotLayer({
        id: 'hotspots',
        data: binary,
        radiusUnits: 'pixels',
        radiusMinPixels: 1.4,
        radiusMaxPixels: 14,
        stroked: false,
        pickable: true,
        // Under the glow the dots stay as a faint grain, and take over as it fades.
        opacity: 0.92 * (1 - 0.8 * glow),
        extensions: [DAY_FILTER],
        filterRange: dayRange,
        filterSoftRange: softRange,
      }))
    }

    if (topAreas.length) {
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
        fontSettings: { sdf: true },
        pickable: false,
      }))
    }

    if (selection) {
      layers.push(new PolygonLayer<Selection>({
        id: 'selection-circle',
        data: [selection],
        getPolygon: (s) => circlePolygon(s.lat, s.lon, s.radius_km),
        filled: true,
        getFillColor: [124, 196, 255, 14],
        stroked: true,
        getLineColor: [124, 196, 255, 235],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
      }))
      layers.push(new ScatterplotLayer<Selection>({
        id: 'selection-centre',
        data: [selection],
        getPosition: (s) => [s.lon, s.lat],
        radiusUnits: 'pixels',
        getRadius: 5,
        filled: true,
        getFillColor: [124, 196, 255, 255],
        stroked: true,
        getLineColor: [10, 10, 14, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
      }))
    }

    overlay.setProps({ layers })
  }, [binary, field, zoom, dayRange, softRange, selection, topAreas])

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
