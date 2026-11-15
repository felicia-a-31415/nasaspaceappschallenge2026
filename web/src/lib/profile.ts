// The small shape drawn behind the time track, so a user can aim at a fire season
// instead of hunting for it. It is total fire intensity per month across Quebec.
//
// The two cameras are scaled apart, each to its own tallest month, for the same reason
// the yearly chart is two charts: one scale across February 2012 would show the camera
// changing and call it fire.

import { monthStartDay, SWITCH_MONTH } from './days'

interface Dated {
  count: number
  epoch: string
  day: ArrayLike<number>
  frp: ArrayLike<number>
}

/** Total intensity in each month of `months`, in megawatts. */
export function monthlyIntensity(h: Dated, months: string[]): number[] {
  const totals = new Array<number>(months.length).fill(0)
  if (!months.length) return totals
  const starts = months.map((m) => monthStartDay(h.epoch, m))
  let m = 0
  for (let i = 0; i < h.count; i++) {
    const day = h.day[i]
    if (day < starts[m]) m = 0                      // not in day order: start over
    while (m + 1 < starts.length && day >= starts[m + 1]) m++
    if (day >= starts[0]) totals[m] += h.frp[i]
  }
  return totals
}

/**
 * Heights from 0 to 1, each side of the camera change on its own scale. The square root
 * keeps an ordinary season visible beside an extreme one; this shape is for aiming, and
 * no number is read off it.
 */
export function profileHeights(totals: number[], months: string[]): number[] {
  const split = months.findIndex((m) => m >= SWITCH_MONTH)
  const at = split < 0 ? months.length : split
  const topOlder = Math.max(0, ...totals.slice(0, at))
  const topNewer = Math.max(0, ...totals.slice(at))
  return totals.map((value, i) => {
    const top = i < at ? topOlder : topNewer
    return top > 0 ? Math.sqrt(value / top) : 0
  })
}
