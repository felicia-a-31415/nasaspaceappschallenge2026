// The two-handled month range, as plain arithmetic. A drag is described by the handle
// that stays put (the anchor) and where the pointer is: the range is simply the two in
// order. That is what lets one handle be dragged straight through the other, and what
// keeps the control alive when both handles sit on the same month.

export type MonthSpan = [number, number]

/** Which end stays put when the pointer goes down at `at`: the one further away. */
export function anchorFor([from, to]: MonthSpan, at: number): number {
  const toFrom = Math.abs(at - from)
  const toTo = Math.abs(at - to)
  if (toFrom < toTo) return to
  if (toTo < toFrom) return from
  // Equally near (always true when the handles coincide): the side the pointer is on
  // decides, and with the pointer exactly on both, either end is the same month.
  return at < from ? to : from
}

/** The range while dragging: the anchor and the pointer, in order. */
export function spanFrom(anchor: number, at: number): MonthSpan {
  return at < anchor ? [at, anchor] : [anchor, at]
}

/** The month index under a pointer, from its position along the track. */
export function monthAt(x: number, trackLeft: number, trackWidth: number, last: number): number {
  if (trackWidth <= 0 || last <= 0) return 0
  const share = (x - trackLeft) / trackWidth
  return Math.min(last, Math.max(0, Math.round(share * last)))
}

/** One handle moved from the keyboard. It stops at the other handle rather than crossing. */
export function nudge([from, to]: MonthSpan, handle: 'from' | 'to', key: string, last: number): MonthSpan | null {
  const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 }[key]
  const current = handle === 'from' ? from : to
  let next: number
  if (step !== undefined) next = current + step
  else if (key === 'Home') next = 0
  else if (key === 'End') next = last
  else return null
  next = Math.min(last, Math.max(0, next))
  return handle === 'from' ? [Math.min(next, to), to] : [from, Math.max(next, from)]
}
