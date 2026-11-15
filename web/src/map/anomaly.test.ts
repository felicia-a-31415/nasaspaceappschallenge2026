import { describe, expect, it } from 'vitest'
import type { HotspotArrays } from '../types'
import { computeAnomaly, fireDays, zClass } from './anomaly'
import { dateToDay } from '../lib/days'

const EPOCH = '2000-01-01'

/** A record from a list of [date, lat, lon], sorted by day as the server sends it. */
function record(rows: [string, number, number][]): HotspotArrays {
  const sorted = rows
    .map(([date, lat, lon]) => ({ day: dateToDay(EPOCH, date), lat, lon }))
    .sort((a, b) => a.day - b.day)
  const count = sorted.length
  return {
    count, epoch: EPOCH, dataThrough: '2026-12-31', bbox: [-80, 45, -57, 63],
    positions: Float32Array.from(sorted.flatMap((r) => [r.lon, r.lat])),
    day: Float32Array.from(sorted.map((r) => r.day)),
    frp: new Float32Array(count), sensor: new Uint8Array(count),
    colors: new Uint8Array(count * 3), radius: new Float32Array(count),
    minDay: dateToDay(EPOCH, '2012-01-01'), maxDay: dateToDay(EPOCH, '2026-12-31'),
  }
}

describe('fireDays', () => {
  it('counts a cell once per day however many detections it has', () => {
    const h = record([['2020-06-01', 50.05, -74.05], ['2020-06-01', 50.06, -74.04], ['2020-06-02', 50.05, -74.05]])
    const counts = fireDays(h, dateToDay(EPOCH, '2020-06-01'), dateToDay(EPOCH, '2020-06-30'))
    expect([...counts.values()]).toEqual([2])
  })
})

describe('computeAnomaly', () => {
  const quiet: [string, number, number][] = [2013, 2014, 2015, 2016, 2017, 2018].map((y) => [`${y}-06-10`, 50.05, -74.05])
  const busy: [string, number, number][] = [1, 2, 3, 4, 5].map((d) => [`2020-06-0${d}`, 50.05, -74.05])

  it('standardizes against the same months in other years of the same sensor', () => {
    const result = computeAnomaly(record([...quiet, ...busy]), '2020-06', '2020-06')
    if (!result.ok) throw new Error(result.reason)
    expect(result.era).toBe('VIIRS')
    expect(result.years).not.toContain(2020)
    const cell = result.cells[0]
    expect(cell.x).toBe(5)
    // Six years with one fire-day among fourteen: sd is under the floor of 1.
    expect(cell.z).toBeCloseTo(5 - cell.mean, 6)
    expect(cell.z).toBeGreaterThan(3)
  })

  it('reports a cell that burned in the baseline but not now as below normal', () => {
    const result = computeAnomaly(record(quiet), '2020-06', '2020-06')
    if (!result.ok) throw new Error(result.reason)
    expect(result.cells[0].x).toBe(0)
    expect(result.cells[0].z).toBeLessThan(0)
  })

  it('gives no anomaly across the sensor transition or for long periods', () => {
    const h = record(quiet)
    expect(computeAnomaly(h, '2011-11', '2012-03').ok).toBe(false)
    expect(computeAnomaly(h, '2018-01', '2020-06').ok).toBe(false)
  })
})

describe('zClass', () => {
  it('puts z in the class its boundaries name', () => {
    expect([-2, -0.7, 0, 0.7, 1.5, 2.5, 9].map(zClass)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})
