// The view: one place, one circle, one period, one way of looking at it. This is the
// single description of what the page is showing. It is what a shared link carries, and
// it is exactly what a forecast would be asked about, which is why the two share a type.
//
// It lives in the query string, never the path: the server serves the built page from
// "/" and does not route unknown paths.

export type Mode = 'record' | 'shift'

export interface View {
  /** Null until a place is chosen. */
  lat: number | null
  lon: number | null
  /** Only one of the server's allowed radii. */
  radius_km: number
  /** First month, YYYY-MM. Null means the start of the record. */
  from: string | null
  /** Last month, YYYY-MM. Null means the end of the record, wherever that is by then. */
  to: string | null
  /** "record" is the full historical page; "shift" is the situation board for someone on duty. */
  mode: Mode
  /**
   * The day the situation board is read as of, YYYY-MM-DD. Null means the last day of the
   * record, wherever that is by then. Only the operational view uses it.
   */
  on: string | null
}

export const RADII_KM = [50, 100, 200]

export const DEFAULT_VIEW: View = {
  lat: null, lon: null, radius_km: 100, from: null, to: null, mode: 'record', on: null,
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function numberIn(text: string | null, limit: number): number | null {
  if (text === null || text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null
}

/** Read a view from a query string. Anything missing or malformed falls back to the default. */
export function parseView(search: string): View {
  const q = new URLSearchParams(search)
  const lat = numberIn(q.get('lat'), 90)
  const lon = numberIn(q.get('lon'), 180)
  const radius = Number(q.get('radius_km'))
  let from = MONTH.test(q.get('from') ?? '') ? q.get('from') : null
  let to = MONTH.test(q.get('to') ?? '') ? q.get('to') : null
  if (from && to && from > to) [from, to] = [to, from]
  return {
    // Half a place is no place.
    lat: lat !== null && lon !== null ? lat : null,
    lon: lat !== null && lon !== null ? lon : null,
    radius_km: RADII_KM.includes(radius) ? radius : DEFAULT_VIEW.radius_km,
    from,
    to,
    mode: q.get('mode') === 'shift' ? 'shift' : 'record',
    on: DAY.test(q.get('on') ?? '') ? q.get('on') : null,
  }
}

/** Write a view as a query string, without the leading "?". Defaults are left out. */
export function serializeView(view: View): string {
  const q = new URLSearchParams()
  if (view.lat !== null && view.lon !== null) {
    q.set('lat', String(Number(view.lat.toFixed(4))))
    q.set('lon', String(Number(view.lon.toFixed(4))))
  }
  if (view.radius_km !== DEFAULT_VIEW.radius_km) q.set('radius_km', String(view.radius_km))
  if (view.from) q.set('from', view.from)
  if (view.to) q.set('to', view.to)
  if (view.mode !== DEFAULT_VIEW.mode) q.set('mode', view.mode)
  if (view.on) q.set('on', view.on)
  return q.toString()
}

/** Does this link say anything at all? A bare address plays the record from the start. */
export function isDefaultView(view: View): boolean {
  return serializeView(view) === ''
}
