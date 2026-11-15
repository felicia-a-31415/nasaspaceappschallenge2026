import { describe, expect, it } from 'vitest'
import { anchorFor, monthAt, nudge, spanFrom } from './rangeDrag'

describe('the two-handled range', () => {
  it('moves the nearer handle and keeps the other', () => {
    expect(anchorFor([10, 50], 12)).toBe(50)
    expect(anchorFor([10, 50], 45)).toBe(10)
  })

  it('stays alive when both handles are on the same month', () => {
    // This is the bug the old control had: handles together, nothing would move.
    const anchor = anchorFor([30, 30], 30)
    expect(spanFrom(anchor, 20)).toEqual([20, 30])
    expect(spanFrom(anchor, 44)).toEqual([30, 44])
    expect(spanFrom(anchorFor([30, 30], 12), 12)).toEqual([12, 30])
  })

  it('lets one handle be dragged through the other', () => {
    const anchor = anchorFor([10, 50], 48) // grabbed the right-hand handle
    expect(spanFrom(anchor, 30)).toEqual([10, 30])
    expect(spanFrom(anchor, 10)).toEqual([10, 10])
    expect(spanFrom(anchor, 4)).toEqual([4, 10])
  })

  it('reads a month from a pointer position, clamped to the track', () => {
    expect(monthAt(100, 100, 400, 312)).toBe(0)
    expect(monthAt(500, 100, 400, 312)).toBe(312)
    expect(monthAt(300, 100, 400, 312)).toBe(156)
    expect(monthAt(-50, 100, 400, 312)).toBe(0)
    expect(monthAt(9999, 100, 400, 312)).toBe(312)
  })

  it('moves a handle from the keyboard without crossing the other', () => {
    expect(nudge([10, 20], 'from', 'ArrowRight', 312)).toEqual([11, 20])
    expect(nudge([10, 20], 'to', 'PageUp', 312)).toEqual([10, 32])
    expect(nudge([20, 20], 'from', 'ArrowRight', 312)).toEqual([20, 20])
    expect(nudge([20, 20], 'from', 'ArrowLeft', 312)).toEqual([19, 20])
    expect(nudge([20, 20], 'to', 'End', 312)).toEqual([20, 312])
    expect(nudge([10, 20], 'to', 'a', 312)).toBeNull()
  })
})
