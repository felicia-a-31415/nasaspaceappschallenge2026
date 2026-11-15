// The ground under the fire data. The vector style gives crisp coasts, lakes, borders
// and names; on top of its flat fills this adds real texture: shaded relief and an
// elevation tint from open terrain tiles, or NASA's Blue Marble imagery. None of it
// needs a key.

import type { Map as MapLibreMap } from 'maplibre-gl'

export type BaseMap = 'terrain' | 'satellite' | 'dark'

export const BASE_MAPS: { id: BaseMap; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'dark', label: 'Plain' },
]

/** A free dark style that needs no key. Its attribution travels with the style. */
export const BASE_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** The first layer of names in the style. Fire data is drawn just beneath it. */
export const UNDER_LABELS = 'waterway_label'

const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const BLUE_MARBLE_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
  + 'BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'

export const BASE_CREDIT = 'Base map © OpenStreetMap contributors, © CARTO · Terrain: Mapzen, AWS · Imagery: NASA GIBS'

/** The font stack the style's own labels use, so the glyphs are known to exist. */
const LABEL_FONT = ['Montserrat Medium', 'Open Sans Regular', 'Noto Sans Regular', 'Noto Sans CJK JP Regular']

const LAND_FILLS = ['landcover', 'park_national_park', 'park_nature_reserve', 'landuse_residential', 'landuse']
const GRID_LAYERS = ['grid-5', 'grid-1', 'grid-half', 'grid-5-label', 'grid-1-label', 'grid-half-label']

/** Add everything this page draws under and over the style's own layers. Once, on load. */
export function dressStyle(map: MapLibreMap) {
  const dem = {
    type: 'raster-dem' as const,
    tiles: [TERRAIN_TILES],
    tileSize: 256,
    maxzoom: 12,
    encoding: 'terrarium' as const,
  }
  // One source each: a source shared between two relief layers is prepared twice.
  map.addSource('dem-tint', dem)
  map.addSource('dem-shade', dem)
  map.addSource('blue-marble', { type: 'raster', tiles: [BLUE_MARBLE_TILES], tileSize: 256, maxzoom: 8 })

  const bottom = LAND_FILLS.find((id) => map.getLayer(id))
  map.addLayer({
    id: 'imagery',
    type: 'raster',
    source: 'blue-marble',
    layout: { visibility: 'none' },
    // Held back, so the fire colours stay the brightest thing on the map.
    paint: { 'raster-brightness-max': 0.9, 'raster-saturation': -0.15, 'raster-contrast': 0.18, 'raster-fade-duration': 0 },
  }, bottom)
  map.addLayer({
    id: 'relief-tint',
    type: 'color-relief',
    source: 'dem-tint',
    paint: {
      'color-relief-color': [
        'interpolate', ['linear'], ['elevation'],
        0, '#131f20',
        150, '#182a25',
        350, '#22352a',
        600, '#323c2e',
        900, '#484735',
        1300, '#625a48',
      ],
    },
  }, bottom)
  map.addLayer({
    id: 'relief-shade',
    type: 'hillshade',
    source: 'dem-shade',
    paint: {
      'hillshade-exaggeration': 0.55,
      'hillshade-shadow-color': '#020405',
      'hillshade-highlight-color': 'rgba(220, 232, 226, 0.62)',
      'hillshade-accent-color': '#05090a',
    },
  }, map.getLayer('waterway') ? 'waterway' : undefined)

  // Borders and names are what a position is read against, so they are drawn firmly.
  setPaint(map, 'boundary_state', 'line-color', 'rgba(214, 224, 232, 0.5)')
  setPaint(map, 'boundary_country_inner', 'line-color', 'rgba(214, 224, 232, 0.7)')
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol' || !layer.id.startsWith('place_')) continue
    map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(4, 7, 9, 0.9)')
    map.setPaintProperty(layer.id, 'text-halo-width', 1.4)
  }

  // The latitude and longitude grid: every 5 degrees, then every degree, then every half.
  const tiers: [id: string, step: number, except: number, minzoom: number, alpha: number][] = [
    ['grid-5', 5, 0, 0, 0.26],
    ['grid-1', 1, 5, 4.6, 0.16],
    ['grid-half', 0.5, 1, 7.6, 0.11],
  ]
  for (const [id, step, except, minzoom, alpha] of tiers) {
    map.addSource(id, { type: 'geojson', data: graticule(step, except) })
    map.addLayer({
      id, type: 'line', source: id, minzoom,
      paint: { 'line-color': `rgba(196, 220, 238, ${alpha})`, 'line-width': 0.7 },
    }, UNDER_LABELS)
    map.addLayer({
      id: `${id}-label`, type: 'symbol', source: id, minzoom,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 460,
        'text-field': ['get', 'label'],
        'text-font': LABEL_FONT,
        'text-size': 10,
        'text-letter-spacing': 0.08,
        'text-padding': 12,
      },
      paint: {
        'text-color': 'rgba(206, 226, 240, 0.78)',
        'text-halo-color': 'rgba(4, 7, 9, 0.9)',
        'text-halo-width': 1.3,
      },
    })
  }
}

function setPaint(map: MapLibreMap, id: string, name: string, value: string | number) {
  if (map.getLayer(id)) map.setPaintProperty(id, name as Parameters<MapLibreMap['setPaintProperty']>[1], value)
}

function show(map: MapLibreMap, id: string, on: boolean) {
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}

/** Switch the ground. The layers all exist already; this only shows, hides and tints. */
export function applyBase(map: MapLibreMap, base: BaseMap) {
  show(map, 'imagery', base === 'satellite')
  show(map, 'relief-tint', base === 'terrain')
  show(map, 'relief-shade', base !== 'dark')
  // The style's flat land fills would paint over the relief and the imagery.
  for (const id of LAND_FILLS) show(map, id, base === 'dark')
  setPaint(map, 'relief-shade', 'hillshade-exaggeration', base === 'satellite' ? 0.3 : 0.55)
  setPaint(map, 'background', 'background-color', base === 'dark' ? '#0e0e0e' : '#0e1719')
  setPaint(map, 'water', 'fill-color', base === 'dark' ? '#2C353C' : base === 'terrain' ? '#081a2a' : '#050f18')
  setPaint(map, 'water', 'fill-opacity', base === 'satellite' ? 0.45 : 1)
  setPaint(map, 'waterway', 'line-color', base === 'dark' ? 'rgba(63, 90, 109, 1)' : '#0f2c40')
}

export function showGraticule(map: MapLibreMap, on: boolean) {
  for (const id of GRID_LAYERS) show(map, id, on)
}

/** Place names, water names and road names: everything the style writes on the map. */
export function showLabels(map: MapLibreMap, on: boolean) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'symbol' && !layer.id.startsWith('grid-')) show(map, layer.id, on)
  }
}

/** Where the grid is drawn: generously around Quebec. */
const WEST = -110
const EAST = -40
const SOUTH = 36
const NORTH = 70

function degrees(value: number, positive: string, negative: string): string {
  const size = Math.abs(value)
  return `${Number.isInteger(size) ? size : size.toFixed(1)}°${value < 0 ? negative : positive}`
}

/**
 * Lines of latitude and longitude every `step` degrees, each carrying its own label.
 * Lines that a coarser grid already draws (multiples of `except`) are left out.
 */
export function graticule(step: number, except = 0): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
  const skip = (value: number) => except > 0 && Math.abs(value / except - Math.round(value / except)) < 1e-9
  for (let lon = WEST; lon <= EAST; lon += step) {
    if (skip(lon)) continue
    features.push({
      type: 'Feature',
      properties: { label: degrees(lon, 'E', 'W') },
      geometry: { type: 'LineString', coordinates: [[lon, SOUTH], [lon, NORTH]] },
    })
  }
  for (let lat = SOUTH; lat <= NORTH; lat += step) {
    if (skip(lat)) continue
    features.push({
      type: 'Feature',
      properties: { label: degrees(lat, 'N', 'S') },
      geometry: { type: 'LineString', coordinates: [[WEST, lat], [EAST, lat]] },
    })
  }
  return { type: 'FeatureCollection', features }
}
