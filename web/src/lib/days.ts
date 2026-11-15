// Dates on this page come in two shapes: whole days since the hotspot epoch (what the
// graphics card filters on) and YYYY-MM months (what every other endpoint asks for).

const MS_PER_DAY = 86_400_000

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Days since `epoch` (both YYYY-MM-DD) as a whole number. */
export function dateToDay(epoch: string, date: string): number {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(epoch + 'T00:00:00Z')) / MS_PER_DAY)
}

/** The YYYY-MM-DD date `day` days after `epoch`. */
export function dayToDate(epoch: string, day: number): string {
  const d = new Date(Date.parse(epoch + 'T00:00:00Z') + Math.round(day) * MS_PER_DAY)
  return d.toISOString().slice(0, 10)
}

/** The YYYY-MM month `day` days after `epoch`. */
export function dayToMonth(epoch: string, day: number): string {
  return dayToDate(epoch, day).slice(0, 7)
}

/** Every month from `from` to `to` inclusive, both YYYY-MM. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/** First day of `month` (YYYY-MM) in days since `epoch`. */
export function monthStartDay(epoch: string, month: string): number {
  return dateToDay(epoch, `${month}-01`)
}

/** Last day of `month` (YYYY-MM) in days since `epoch`. */
export function monthEndDay(epoch: string, month: string): number {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return dateToDay(epoch, next) - 1
}

/** Is this YYYY-MM-DD the last day of its month? */
export function isMonthEnd(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  return d === new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The month before this one, YYYY-MM. */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** "2023-06" to "June 2023". */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/** "2026-11-13" to "13 November 2026". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`
}

/** "May to July 2023", "January 2009", "2023": how the server names a summary's period. */
export function periodLabel(year: number, months: number[]): string {
  if (months.length === 12) return String(year)
  if (months.length === 1) return `${MONTH_NAMES[months[0] - 1]} ${year}`
  return `${MONTH_NAMES[months[0] - 1]} to ${MONTH_NAMES[months[months.length - 1] - 1]} ${year}`
}

/** The month a sharper camera took over, marked everywhere time is shown. */
export const SWITCH_MONTH = '2012-02'
