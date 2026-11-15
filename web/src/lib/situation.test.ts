import { describe, expect, it } from 'vitest'
import { toHotspotArrays } from '../map/hotspotArrays'
import { dateToDay } from './days'
import {
  activeCells, ageClass, circleScope, dailyCounts, lastSeen, nearest, regionScope, seasonToDate, situation, tally,
} from './situation'

const EPOCH = '2000-01-01'
const day = (date: string) => dateToDay(EPOCH, date)

/** Rows of [date, lat, lon, frp], given in any order. */
function record(rows: [string, number, number, number][]) {
  const sorted = [...rows].sort((a, b) => day(a[0]) - day(b[0]))
  return toHotspotArrays({
    region: 'test', epoch: EPOCH, count: sorted.length, data_through: sorted[sorted.length - 1][0],
    bbox: [-80, 44, -57, 63],
    lon: sorted.map((r) => r[2]), lat: sorted.map((r) => r[1]),
    day: sorted.map((r) => day(r[0])), frp: sorted.map((r) => r[3]),
    sensor: sorted.map((r) => (r[0] >= '2012-02-01' ? 1 : 0)),
  })
}

const h = record([
  ['2023-05-20', 50.0, -75.0, 5],
  ['2023-05-30', 50.0, -75.0, 10],
  ['2023-06-03', 50.02, -74.99, 20],
  ['2023-06-05', 50.0, -75.0, 40],
  ['2023-06-05', 52.0, -70.0, 300],
  ['2023-06-09', 50.0, -75.0, 80],
  ['2021-06-01', 50.0, -75.0, 1],
  ['2020-06-01', 50.0, -75.0, 1],
  ['2020-06-02', 50.0, -75.0, 1],
  ['2019-07-01', 50.0, -75.0, 1],
  ['2026-11-13', 46.0, -72.0, 2],
])
const asOf = day('2023-06-05')

describe('the situation board', () => {
  it('puts a detection in an age class by days before the as-of day', () => {
    expect([0, 1, 2, 3, 6].map(ageClass)).toEqual([0, 1, 1, 2, 2])
  })

  it('counts a circle apart from the region, and never past the as-of day', () => {
    const region = regionScope(h)
    const circle = circleScope(h, 50, -75, 50)
    expect(tally(region, asOf, asOf)).toEqual({ detections: 2, sumFrp: 340, maxFrp: 300 })
    expect(tally(circle, asOf, asOf)).toEqual({ detections: 1, sumFrp: 40, maxFrp: 40 })
    expect(tally(circle, asOf - 6, asOf).detections).toBe(3)
  })

  it('lays daily counts oldest first, ending on the as-of day', () => {
    const counts = dailyCounts(circleScope(h, 50, -75, 50), asOf - 6, asOf)
    expect(counts).toEqual([1, 0, 0, 0, 1, 0, 1])
  })

  it('finds the last day with fire when the window is empty', () => {
    const circle = circleScope(h, 50, -75, 50)
    expect(lastSeen(circle, day('2023-05-01'))).toBe(day('2021-06-01'))
    expect(lastSeen(circleScope(h, 60, -60, 50), asOf)).toBeNull()
  })

  it('names the nearest detection in the window by distance and compass point', () => {
    const near = nearest(h, 49.5, -75, asOf - 6, asOf)!
    expect(near.toward).toBe('N')
    expect(near.km).toBeGreaterThan(50)
    expect(near.km).toBeLessThan(60)
    expect(nearest(h, 49.5, -75, day('2022-01-01'), day('2022-01-07'))).toBeNull()
  })

  it('compares the year to date with the same dates in other years of the same sensor', () => {
    const season = seasonToDate(circleScope(h, 50, -75, 50), EPOCH, asOf, h.minDay, h.maxDay)!
    expect(season.sensor).toBe('VIIRS')
    expect(season.detections).toBe(4)
    expect(season.rank).toBe(1)
    expect(season.others.find((o) => o.year === 2020)?.detections).toBe(2)
    // July 2019 is after 5 June, so that year has nothing yet.
    expect(season.others.find((o) => o.year === 2019)?.detections).toBe(0)
    expect(season.others.some((o) => o.year === 2023)).toBe(false)
  })

  it('ranks active cells by summed power and says how old each is', () => {
    const cells = activeCells(h, asOf - 6, asOf, 5)
    expect(cells[0]).toMatchObject({ detections: 1, sumFrp: 300, lastAge: 0, daysActive: 1 })
    expect(cells[1]).toMatchObject({ detections: 3, sumFrp: 70, lastAge: 0, daysActive: 3 })
    expect(cells).toHaveLength(2)
  })

  it('reads the whole board for one day', () => {
    const board = situation(h, circleScope(h, 50, -75, 50), asOf, { lat: 50, lon: -75 })
    expect(board.date).toBe('2023-06-05')
    expect(board.local).toBe(true)
    expect([board.day0.detections, board.last3.detections, board.last7.detections]).toEqual([1, 2, 3])
    expect(board.prior7.detections).toBe(0)
    expect(board.daily).toHaveLength(14)
    expect(board.nearest?.km).toBeLessThan(1)
  })
})
