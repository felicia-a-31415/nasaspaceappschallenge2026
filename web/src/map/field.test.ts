import { describe, expect, it } from 'vitest'
import { fieldShare, sliceByDay } from './field'

describe('the intensity glow', () => {
  it('is all glow zoomed out and all dots zoomed in', () => {
    expect(fieldShare(3)).toBe(1)
    expect(fieldShare(9)).toBe(0)
    expect(fieldShare(6.5)).toBeGreaterThan(0)
    expect(fieldShare(6.5)).toBeLessThan(1)
  })

  it('takes the chosen days as one stretch of the day-ordered arrays', () => {
    const day = new Float32Array([1, 1, 2, 5, 5, 5, 9])
    expect(sliceByDay(day, 2, 5)).toEqual([2, 6])
    expect(sliceByDay(day, 0, 100)).toEqual([0, 7])
    expect(sliceByDay(day, 6, 8)).toEqual([6, 6])
    expect(sliceByDay(day, 10, 20)).toEqual([7, 7])
  })

  it('refuses a list that is not in day order', () => {
    expect(sliceByDay(new Float32Array([3, 1, 2]), 0, 5)).toBeNull()
  })
})
