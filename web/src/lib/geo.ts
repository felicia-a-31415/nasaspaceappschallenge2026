/** The square the harmonization counts in: 0.1 degrees, about 10 km. */
export const CELL_DEG = 0.1

const EARTH_RADIUS_KM = 6371.0088
const RAD = Math.PI / 180

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

/** A circle of `radiusKm` on the ground, as a closed ring of lon/lat pairs. */
export function circlePolygon(lat: number, lon: number, radiusKm: number, steps = 128): [number, number][] {
  const ring: [number, number][] = []
  const angular = radiusKm / EARTH_RADIUS_KM
  const latR = lat * RAD
  const lonR = lon * RAD
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI
    const latOut = Math.asin(
      Math.sin(latR) * Math.cos(angular) + Math.cos(latR) * Math.sin(angular) * Math.cos(bearing),
    )
    const lonOut = lonR + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latR),
      Math.cos(angular) - Math.sin(latR) * Math.sin(latOut),
    )
    ring.push([lonOut / RAD, latOut / RAD])
  }
  return ring
}

/** Index of the 0.1 degree square a point falls in, as a single integer. */
export function cellIndex(lat: number, lon: number): number {
  const row = Math.floor(lat / CELL_DEG) + 1000
  const col = Math.floor(lon / CELL_DEG) + 2000
  return row * 10000 + col
}

/** Centre of the square `cellIndex` named. */
export function cellCentre(index: number): { lat: number; lon: number } {
  const row = Math.floor(index / 10000) - 1000
  const col = (index % 10000) - 2000
  return {
    lat: Number(((row + 0.5) * CELL_DEG).toFixed(3)),
    lon: Number(((col + 0.5) * CELL_DEG).toFixed(3)),
  }
}

/** Accepts "49.9, -74.4" and "49.9 -74.4"; null when the text is not a coordinate pair. */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}
