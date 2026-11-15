import { describe, expect, it } from 'vitest'
import { toHotspotArrays } from './hotspotArrays'
import type { HotspotsResponse } from '../types'

const response: HotspotsResponse = {
  region: 'quebec',
  epoch: '2000-01-01',
  count: 3,
  data_through: '2026-11-13',
  bbox: [-79.8, 44.9, -57.1, 62.6],
  lon: [-78.5532, -78.5609, -74.4],
  lat: [49.1541, 49.151, 49.9],
  day: [311, 311, 9813],
  frp: [40.7, 0, 9939],
  sensor: [0, 0, 1],
}

describe('toHotspotArrays', () => {
  it('keeps every value and finds the first and last day', () => {
    const h = toHotspotArrays(response)
    expect(h.count).toBe(3)
    expect(h.minDay).toBe(311)
    expect(h.maxDay).toBe(9813)
    expect([...h.sensor]).toEqual([0, 0, 1])
    expect(h.positions[0]).toBeCloseTo(-78.5532, 3)
    expect(h.positions[1]).toBeCloseTo(49.1541, 3)
    expect(h.positions[4]).toBeCloseTo(-74.4, 3)
  })

  it('gives every dot a colour and a size', () => {
    const h = toHotspotArrays(response)
    expect(h.colors.length).toBe(9)
    // The strongest fire is lighter and larger than the weakest.
    expect(h.colors[6]).toBeGreaterThan(h.colors[3])
    expect(h.radius[2]).toBeGreaterThan(h.radius[1])
  })

  it('survives an empty region', () => {
    const h = toHotspotArrays({ ...response, count: 0, lon: [], lat: [], day: [], frp: [], sensor: [] })
    expect(h.minDay).toBe(0)
    expect(h.maxDay).toBe(0)
  })
})
