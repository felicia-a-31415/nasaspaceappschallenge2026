import { describe, expect, it } from 'vitest'
import { cellCentre, cellIndex, circlePolygon, distanceKm, parseCoordinates } from './geo'

describe('geo', () => {
  it('measures a known distance', () => {
    // Montreal to Chibougamau, about 530 km.
    expect(distanceKm(45.5, -73.57, 49.92, -74.37)).toBeGreaterThan(480)
    expect(distanceKm(45.5, -73.57, 49.92, -74.37)).toBeLessThan(560)
    expect(distanceKm(49.9, -74.4, 49.9, -74.4)).toBe(0)
  })

  it('draws a closed circle of the right size', () => {
    const ring = circlePolygon(49.9, -74.4, 100)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    for (const [lon, lat] of ring) {
      expect(distanceKm(49.9, -74.4, lat, lon)).toBeCloseTo(100, 1)
    }
  })

  it('rounds points to the centre of their 10 km square', () => {
    const c = cellCentre(cellIndex(49.9712, -74.3611))
    expect(c).toEqual({ lat: 49.95, lon: -74.35 })
    // Negative longitudes must not fold onto the wrong square.
    expect(cellIndex(49.9712, -74.3611)).not.toBe(cellIndex(49.9712, 74.3611))
  })

  it('reads coordinates in both forms and rejects place names', () => {
    expect(parseCoordinates('49.9, -74.4')).toEqual({ lat: 49.9, lon: -74.4 })
    expect(parseCoordinates('49.9 -74.4')).toEqual({ lat: 49.9, lon: -74.4 })
    expect(parseCoordinates(' 49.9,-74.4 ')).toEqual({ lat: 49.9, lon: -74.4 })
    expect(parseCoordinates('Chibougamau')).toBeNull()
    expect(parseCoordinates('999, -74.4')).toBeNull()
    expect(parseCoordinates('49.9')).toBeNull()
  })
})
