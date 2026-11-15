// The mock answer has to behave like the server, so that switching VITE_USE_MOCKS off
// changes nothing on screen. The rule under test: a month the record is only part way
// through is left out of the comparison (harmonize/query.py: summarize's `through`).

import { beforeAll, describe, expect, it } from 'vitest'
import { toHotspotArrays } from '../map/hotspotArrays'
import type { HotspotsResponse } from '../types'
import { activity } from './index'
import { setMockHotspots } from './store'

const EPOCH = '2000-01-01'
const LAT = 50
const LON = -75
const DATA_THROUGH = '2026-11-14'     // part way through November

/** One detection every October from 2013 on, plus one in the unfinished November. */
function sampleHotspots(): HotspotsResponse {
  const dates: string[] = []
  for (let year = 2013; year <= 2026; year++) dates.push(`${year}-10-15`)
  dates.push('2026-11-05')
  dates.sort()
  const day = (date: string) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(EPOCH + 'T00:00:00Z')) / 86_400_000)
  return {
    region: 'quebec',
    epoch: EPOCH,
    count: dates.length,
    data_through: DATA_THROUGH,
    bbox: [-79.8, 44.9, -57.1, 62.6],
    lon: dates.map(() => LON),
    lat: dates.map(() => LAT),
    day: dates.map(day),
    frp: dates.map(() => 12.5),
    sensor: dates.map(() => 1),
  }
}

const selection = { lat: LAT, lon: LON, radius_km: 100 }

beforeAll(() => {
  setMockHotspots(toHotspotArrays(sampleHotspots()))
})

describe('the mock activity answer', () => {
  it('stops the comparison before the month still in progress', async () => {
    const answer = await activity({ ...selection, from: '2026-01', to: '2026-11' })
    expect(answer.summary).not.toBeNull()
    // November is still going: the sentence covers January to October.
    expect(answer.summary?.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(answer.summary?.sentence).toContain('January to October 2026')
    expect(answer.summary?.sentence).not.toContain('November')
    // The months themselves are untouched: November is still shown on the page.
    expect(answer.months.map((m) => m.month)).toContain('2026-11')
  })

  it('has nothing to say when the only month chosen is the unfinished one', async () => {
    const answer = await activity({ ...selection, from: '2026-11', to: '2026-11' })
    expect(answer.summary).toBeNull()
    expect(answer.months).toHaveLength(1)
  })

  it('still answers for a range that ends before this month', async () => {
    const answer = await activity({ ...selection, from: '2025-01', to: '2025-10' })
    expect(answer.summary?.sentence).toContain('January to October 2025')
  })
})
