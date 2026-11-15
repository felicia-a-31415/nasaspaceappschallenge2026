import { DataFilterExtension } from '@deck.gl/extensions'
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import { Map as MapLibreMap, MapMouseEvent, NavigationControl, ScaleControl } from 'maplibre-gl'
import { useEffect, useMemo, useRef } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'

import { formatDate } from '../lib/days'
import { circlePolygon, CELL_DEG } from '../lib/geo'
import type { HotspotArrays, Selection, TopArea } from '../types'

/** A free dark style that needs no key. Its attribution travels with the style. */
const BASE_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** Filtering by day happens on the graphics card, so the slider never rebuilds data. */
const DAY_FILTER = new DataFilterExtension({ filterSize: 1 })

export interface MapViewProps {
  hotspots: HotspotArrays | null
  /** First and last visible day, in days since the hotspot epoch. */
  dayRange: [number, number]
  selection: Selection | null
  topAreas: TopArea[]
  onMapClick: (lat: number, lon: number) => void
  onMapReady?: (map: MapLibreMap) => void
}

export function MapView({ hotspots, dayRange, selection, topAreas, onMapClick, onMapReady }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapLibreOverlay | null>(null)
  const hotspotsRef = useRef<HotspotArrays | null>(null)
  const clickRef = useRef(onMapClick)

  hotspotsRef.current = hotspots
  clickRef.current = onMapClick

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
      attributionControl: { compact: true },
      canvasContextAttributes: {
        // Needed so the animation can be recorded from the canvas (F9).
        preserveDrawingBuffer: true,
        antialias: true,
      },
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
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
            background: 'rgba(12, 12, 16, 0.94)',
            color: '#f4f1ea',
            font: '13px/1.45 system-ui, sans-serif',
            padding: '8px 10px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.18)',
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

    const layers = []
    if (binary) {
      layers.push(new ScatterplotLayer({
        id: 'hotspots',
        data: binary,
        radiusUnits: 'pixels',
        radiusMinPixels: 1.4,
        radiusMaxPixels: 14,
        stroked: false,
        pickable: true,
        opacity: 0.92,
        extensions: [DAY_FILTER],
        filterRange: dayRange,
      }))
    }

    if (topAreas.length) {
      layers.push(new PolygonLayer<TopArea>({
        id: 'top-areas',
        data: topAreas,
        getPolygon: (a) => squareAround(a.lat, a.lon),
        filled: false,
        stroked: true,
        getLineColor: [120, 220, 255, 220],
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
        getColor: [190, 240, 255, 240],
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
        getFillColor: [255, 255, 255, 12],
        stroked: true,
        getLineColor: [255, 255, 255, 190],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
      }))
      layers.push(new ScatterplotLayer<Selection>({
        id: 'selection-centre',
        data: [selection],
        getPosition: (s) => [s.lon, s.lat],
        radiusUnits: 'pixels',
        getRadius: 5,
        filled: true,
        getFillColor: [255, 255, 255, 230],
        stroked: true,
        getLineColor: [10, 10, 14, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
      }))
    }

    overlay.setProps({ layers })
  }, [binary, dayRange, selection, topAreas])

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
