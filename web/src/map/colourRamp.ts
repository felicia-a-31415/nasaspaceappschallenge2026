// Fire intensity is coloured on the "inferno" ramp, which rises steadily from dark to
// light: it survives every kind of colour blindness and still reads in greyscale.
// On this dark map the dim end starts part of the way up the ramp, so the faintest
// fire is still a visible purple rather than black on black.

/** Inferno, sampled every tenth. */
const INFERNO: [number, number, number][] = [
  [0, 0, 4], [22, 11, 57], [66, 10, 104], [106, 23, 110], [147, 38, 103],
  [188, 55, 84], [221, 81, 58], [243, 120, 25], [252, 165, 10], [246, 215, 70],
  [252, 255, 164],
]

/** Where the ramp starts, so the quietest dots stay visible on a dark base map. */
const RAMP_FLOOR = 0.22

/**
 * Everything above this is the top colour. Half of all intensities are under
 * 6.5 MW and 99% under 407 MW, so the scale is logarithmic.
 */
export const TOP_INTENSITY_MW = 500

/** 0 at no intensity, 1 at the top colour. */
export function intensityFraction(frpMw: number): number {
  const t = Math.log1p(Math.max(0, frpMw)) / Math.log1p(TOP_INTENSITY_MW)
  return Math.min(1, Math.max(0, t))
}

/** The colour for a point on the ramp, 0 to 1. */
export function rampColour(fraction: number): [number, number, number] {
  const t = RAMP_FLOOR + Math.min(1, Math.max(0, fraction)) * (1 - RAMP_FLOOR)
  const x = t * (INFERNO.length - 1)
  const i = Math.min(INFERNO.length - 2, Math.floor(x))
  const f = x - i
  const a = INFERNO[i]
  const b = INFERNO[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/** The colour for a fire of this intensity. */
export function intensityColour(frpMw: number): [number, number, number] {
  return rampColour(intensityFraction(frpMw))
}

/** Stronger fires are also drawn larger, so colour is never the only signal. */
export function intensityRadiusPx(frpMw: number): number {
  return 1.6 + intensityFraction(frpMw) * 3.4
}

export function cssColour([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`
}

/** Ticks for the legend, in megawatts. */
export const LEGEND_TICKS = [0, 10, 100, TOP_INTENSITY_MW]
