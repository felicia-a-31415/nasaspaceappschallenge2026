const NUMBER = new Intl.NumberFormat('en-CA')

/** 41230 reads as 41,230. */
export function count(value: number): string {
  return NUMBER.format(Math.round(value))
}

/** Intensities run from fractions of a megawatt to millions, so the unit moves. */
export function megawatts(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'no reading'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} million MW`
  if (value >= 10_000) return `${NUMBER.format(Math.round(value / 1000))} thousand MW`
  if (value >= 100) return `${NUMBER.format(Math.round(value))} MW`
  return `${value.toFixed(1)} MW`
}

/** "49.9, -74.4", the way the search box accepts it back. */
export function coordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

/** 1.0 reads as "the same as", 2.4 as "2.4 times". */
export function times(value: number): string {
  return value >= 0.95 && value <= 1.05 ? 'about the same as' : `${value.toFixed(1)} times`
}
