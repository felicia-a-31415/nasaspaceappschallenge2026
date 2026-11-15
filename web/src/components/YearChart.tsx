import { count } from '../lib/format'
import type { StatsYear } from '../types'

const WIDTH = 300
const HEIGHT = 74
const GAP = 16

/**
 * Fire detections each year. The two cameras are drawn as two charts side by side, each
 * with its own scale and its own top value written out, because a detection from 2005 and
 * a detection from 2024 do not mean the same thing. One unbroken run of bars across 2012
 * would say they do.
 */
export function YearChart({ years }: { years: StatsYear[] }) {
  const older = years.filter((y) => y.sensor === 'MODIS')
  const newer = years.filter((y) => y.sensor === 'VIIRS')
  const groups = [
    { label: 'Older camera', rows: older },
    { label: 'Newer camera', rows: newer },
  ].filter((g) => g.rows.length > 0)
  if (!groups.length) return null

  const slots = years.length
  const spare = WIDTH - (groups.length - 1) * GAP
  let x = 0

  return (
    <figure className="year-chart">
      <figcaption className="small muted">Fire detections each year</figcaption>
      <svg viewBox={`0 -14 ${WIDTH} ${HEIGHT + 28}`} role="img" aria-label={label(groups)}>
        {groups.map((group, index) => {
          const width = (group.rows.length / slots) * spare
          const left = x
          x += width + GAP
          const top = Math.max(1, ...group.rows.map((r) => r.detections))
          const slot = width / group.rows.length
          return (
            <g key={group.label} transform={`translate(${left}, 0)`}>
              {group.rows.map((row, i) => {
                const height = (row.detections / top) * HEIGHT
                // One lonely year should not become a giant block.
                const bar = Math.min(26, Math.max(1, slot * 0.76))
                return (
                  <rect
                    key={row.year}
                    x={i * slot + (slot - bar) / 2}
                    y={HEIGHT - height}
                    width={bar}
                    height={Math.max(row.detections > 0 ? 1 : 0, height)}
                    className={group.label === 'Older camera' ? 'bar-older' : 'bar-newer'}
                  >
                    <title>{`${row.year}: ${count(row.detections)} detections`}</title>
                  </rect>
                )
              })}
              <text x={0} y={HEIGHT + 11} className="axis">{group.rows[0].year}</text>
              {group.rows.length > 1 && (
                <text x={width} y={HEIGHT + 11} textAnchor="end" className="axis">
                  {group.rows[group.rows.length - 1].year}
                </text>
              )}
              <text x={0} y={-4} className="axis camera">{group.label}</text>
              <text x={width} y={-4} textAnchor="end" className="axis">up to {count(top)}</text>
              {index > 0 && <line x1={-GAP / 2} y1={0} x2={-GAP / 2} y2={HEIGHT + 2} className="break" />}
            </g>
          )
        })}
      </svg>
      {groups.length > 1 && (
        <p className="small muted chart-note">
          Two cameras, two scales: the older camera saw far fewer small fires, so the sides
          cannot be compared. For "more or less than usual", read the sentence above.
        </p>
      )}
    </figure>
  )
}

function label(groups: { label: string; rows: StatsYear[] }[]): string {
  return groups
    .map((g) => `${g.label}: ${g.rows[0].year} to ${g.rows[g.rows.length - 1].year}, `
      + `up to ${count(Math.max(...g.rows.map((r) => r.detections)))} detections in a year`)
    .join('. ')
}
