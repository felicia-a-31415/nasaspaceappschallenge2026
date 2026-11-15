import { formatMonth } from '../lib/days'
import { count } from '../lib/format'
import type { ActivityMonth } from '../types'

const WIDTH = 340
const HEIGHT = 96
/** Beyond this many months the chart shows one column per year. */
const MONTHLY_LIMIT = 48

interface Column {
  label: string
  activity: number
  low: number
  high: number
  median: number
  /** Any part of it is lifted from the older camera. */
  estimated: boolean
}

/** One column per year: each year's months added up, usual values included. */
function byYear(months: ActivityMonth[]): Column[] {
  const years = new Map<string, Column>()
  for (const m of months) {
    const year = m.month.slice(0, 4)
    const column = years.get(year) ?? { label: year, activity: 0, low: 0, high: 0, median: 0, estimated: false }
    column.activity += m.activity
    column.low += m.low
    column.high += m.high
    column.median += m.median
    column.estimated ||= m.estimated
    years.set(year, column)
  }
  return [...years.values()]
}

/**
 * Corrected fire activity through the chosen period, against what is usual. This is the
 * one chart on the page allowed a single scale across February 2012, because these are
 * the corrected values. Estimates are drawn open, with a whisker for their likely range,
 * so a measured column and an estimated one never look the same.
 */
export function ActivityChart({ months }: { months: ActivityMonth[] }) {
  if (months.length < 2) return null
  const yearly = months.length > MONTHLY_LIMIT
  const columns: Column[] = yearly
    ? byYear(months)
    : months.map((m) => ({ label: formatMonth(m.month), ...m }))
  const top = Math.max(1, ...columns.map((c) => Math.max(c.high, c.activity, c.median)))
  const slot = WIDTH / columns.length
  const bar = Math.min(18, Math.max(1, slot * 0.7))
  const y = (value: number) => HEIGHT - (value / top) * HEIGHT
  const anyEstimated = columns.some((c) => c.estimated)
  const anyMeasured = columns.some((c) => !c.estimated)
  // Where the newer camera takes over, if the period crosses it.
  const firstMeasured = columns.findIndex((c) => !c.estimated)
  const switchAt = anyEstimated && firstMeasured > 0 ? firstMeasured * slot : null
  const usual = columns
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${(i * slot).toFixed(1)} ${y(c.median).toFixed(1)}H${((i + 1) * slot).toFixed(1)}`)
    .join('')

  return (
    <figure className="activity-chart">
      <figcaption className="eyebrow">
        By {yearly ? 'year' : 'month'}
      </figcaption>
      <svg
        viewBox={`0 -12 ${WIDTH} ${HEIGHT + 26}`}
        role="img"
        aria-label={`Corrected fire activity ${yearly ? 'each year' : 'each month'} from ${columns[0].label} to `
          + `${columns[columns.length - 1].label}, against the usual amount. The highest value is ${count(top)}.`}
      >
        <line x1={0} y1={HEIGHT} x2={WIDTH} y2={HEIGHT} className="base" />
        {columns.map((c, i) => {
          const x = i * slot + (slot - bar) / 2
          const mid = i * slot + slot / 2
          return (
            <g key={c.label}>
              <rect
                x={x} y={y(c.activity)} width={bar}
                height={Math.max(c.activity > 0 ? 1 : 0, HEIGHT - y(c.activity))}
                className={c.estimated ? 'col-estimated' : 'col-measured'}
              />
              {c.estimated && c.high > c.low && (
                <line x1={mid} y1={y(c.high)} x2={mid} y2={y(c.low)} className="whisker" />
              )}
              <title>
                {`${c.label}: ${count(c.activity)}`
                  + (c.estimated ? `, an estimate, likely between ${count(c.low)} and ${count(c.high)}` : ', measured')
                  + `. Usual: ${count(c.median)}.`}
              </title>
            </g>
          )
        })}
        <path d={usual} className="usual" />
        {switchAt !== null && <line x1={switchAt} y1={-4} x2={switchAt} y2={HEIGHT} className="break" />}
                <text x={0} y={HEIGHT + 11} className="axis">{columns[0].label}</text>
        <text x={WIDTH} y={HEIGHT + 11} textAnchor="end" className="axis">{columns[columns.length - 1].label}</text>
      </svg>
      <ul className="chart-key">
        {anyMeasured && <li><i className="key-measured" />Measured</li>}
        {anyEstimated && <li><i className="key-estimated" />Estimated (older sensor)</li>}
        <li><i className="key-usual" />Usual</li>
        {switchAt !== null && <li><i className="key-break" />Sensor change, 2012</li>}
      </ul>
    </figure>
  )
}
