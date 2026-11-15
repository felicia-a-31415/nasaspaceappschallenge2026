import { describe, expect, it } from 'vitest'
import { monthRange } from './days'
import { monthlyIntensity, profileHeights } from './profile'

describe('the shape behind the time track', () => {
  const months = monthRange('2011-12', '2012-03')

  it('adds up intensity by month', () => {
    const h = {
      count: 4, epoch: '2000-01-01',
      day: [4352, 4353, 4414, 4443],   // 1 and 2 Dec 2011, 1 Feb 2012, 1 Mar 2012
      frp: [10, 5, 100, 40],
    }
    expect(monthlyIntensity(h, months)).toEqual([15, 0, 100, 40])
  })

  it('scales each camera to its own tallest month', () => {
    // 15 MW from the older camera and 1,000 MW from the newer are both "the tallest
    // month that camera saw", so both reach the top. Neither is measured against the other.
    const heights = profileHeights([15, 0, 1000, 250], months)
    expect(heights[0]).toBe(1)
    expect(heights[2]).toBe(1)
    expect(heights[3]).toBeCloseTo(0.5, 6)
    expect(heights[1]).toBe(0)
  })
})
