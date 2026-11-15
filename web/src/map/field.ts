// Fire intensity as a glow, for when the map is zoomed out too far for dots to read.

/** Below this zoom the map is all glow; above FIELD_GONE_ZOOM it is all dots. */
export const FIELD_FULL_ZOOM = 5.5
export const FIELD_GONE_ZOOM = 7.5

/** How much of the picture is glow at this zoom, 1 to 0. */
export function fieldShare(zoom: number): number {
  const t = (FIELD_GONE_ZOOM - zoom) / (FIELD_GONE_ZOOM - FIELD_FULL_ZOOM)
  return Math.min(1, Math.max(0, t))
}

/**
 * The stretch of a day-ordered list that falls from `first` to `last` inclusive, as
 * [start, end). Null when the list turns out not to be in day order, in which case the
 * caller draws no glow rather than a wrong one.
 */
export function sliceByDay(day: ArrayLike<number>, first: number, last: number): [number, number] | null {
  const n = day.length
  if (n > 1 && !isOrdered(day)) return null
  const lower = (target: number) => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (day[mid] < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const start = lower(first)
  const end = Math.max(start, lower(last + 1))
  return [start, end]
}

const ordered = new WeakMap<object, boolean>()

function isOrdered(day: ArrayLike<number>): boolean {
  const known = ordered.get(day as object)
  if (known !== undefined) return known
  let ok = true
  for (let i = 1; i < day.length; i++) {
    if (day[i] < day[i - 1]) { ok = false; break }
  }
  ordered.set(day as object, ok)
  return ok
}
