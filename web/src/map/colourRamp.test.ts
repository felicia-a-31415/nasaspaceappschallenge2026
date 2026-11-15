import { describe, expect, it } from 'vitest'
import { intensityColour, intensityFraction, intensityRadiusPx, rampColour } from './colourRamp'

/** Perceived lightness, the part a colour-blind viewer still sees. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('intensity ramp', () => {
  it('is logarithmic and clamped at both ends', () => {
    expect(intensityFraction(0)).toBe(0)
    expect(intensityFraction(500)).toBe(1)
    expect(intensityFraction(9939)).toBe(1)
    expect(intensityFraction(-1)).toBe(0)
    // Half of all fires are under 6.5 MW: they must not all sit in the bottom tenth.
    expect(intensityFraction(6.5)).toBeGreaterThan(0.25)
    expect(intensityFraction(6.5)).toBeLessThan(0.45)
  })

  it('rises steadily in lightness, so colour is not the only signal', () => {
    let previous = -1
    for (let i = 0; i <= 10; i++) {
      const l = luminance(rampColour(i / 10))
      expect(l).toBeGreaterThan(previous)
      previous = l
    }
  })

  it('never puts the dimmest fire at black on a dark map', () => {
    expect(luminance(intensityColour(0))).toBeGreaterThan(12)
  })

  it('makes stronger fires larger', () => {
    expect(intensityRadiusPx(1000)).toBeGreaterThan(intensityRadiusPx(5))
    expect(intensityRadiusPx(0)).toBeGreaterThanOrEqual(1.5)
  })
})
