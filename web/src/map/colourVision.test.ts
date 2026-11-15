// The ramp has to survive colour blindness. Rather than eyeballing a simulator once,
// the three dichromacies are simulated here (Viénot/Brettel matrices, applied in linear
// light) and the ramp is required to keep rising in lightness under each of them.

import { describe, expect, it } from 'vitest'
import { rampColour } from './colourRamp'

type RGB = [number, number, number]

const MATRICES: Record<string, number[][]> = {
  protanopia: [[0.11238, 0.88762, 0], [0.11238, 0.88762, 0], [0.00401, -0.00401, 1]],
  deuteranopia: [[0.29275, 0.70725, 0], [0.29275, 0.70725, 0], [-0.02234, 0.02234, 1]],
  tritanopia: [[1, 0.1483, -0.1483], [0, 1, 0], [0, -0.86744, 1.86744]],
  greyscale: [[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]],
}

const toLinear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)

function simulate(colour: RGB, matrix: number[][]): RGB {
  const [r, g, b] = colour.map(toLinear)
  return matrix.map((row) => row[0] * r + row[1] * g + row[2] * b) as RGB
}

/** Relative luminance of an already-linear colour. */
const lightness = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b

const SAMPLES = Array.from({ length: 21 }, (_, i) => rampColour(i / 20))

describe('the intensity ramp under colour blindness', () => {
  for (const [name, matrix] of Object.entries(MATRICES)) {
    it(`still rises steadily for ${name}`, () => {
      let previous = -1
      for (const colour of SAMPLES) {
        const l = lightness(simulate(colour, matrix))
        expect(l).toBeGreaterThan(previous)
        previous = l
      }
    })

    it(`keeps the two ends far apart for ${name}`, () => {
      const low = lightness(simulate(SAMPLES[0], matrix))
      const high = lightness(simulate(SAMPLES[SAMPLES.length - 1], matrix))
      // Contrast ratio between the quietest and the fiercest fire.
      expect((high + 0.05) / (low + 0.05)) .toBeGreaterThan(8)
    })
  }
})
