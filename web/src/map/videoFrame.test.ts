import { describe, expect, it } from 'vitest'
import { cover } from './videoFrame'

describe('cover', () => {
  it('fills a 16:9 frame from a wider map without letterboxing', () => {
    const { scale, x, y } = cover(2880, 1682, 1920, 1080)
    expect(2880 * scale).toBeGreaterThanOrEqual(1920 - 0.001)
    expect(1682 * scale).toBeGreaterThanOrEqual(1080 - 0.001)
    // Whatever spills over is split evenly, so the middle of the map stays in the middle.
    expect(x).toBeLessThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(0)
    expect(x * 2 + 2880 * scale).toBeCloseTo(1920, 6)
  })

  it('fills a 16:9 frame from a taller window too', () => {
    const { scale } = cover(900, 1400, 1920, 1080)
    expect(900 * scale).toBeGreaterThanOrEqual(1920)
    expect(1400 * scale).toBeGreaterThanOrEqual(1080)
  })
})
