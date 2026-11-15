import { useEffect, useRef, useState } from 'react'
import { chartUrl } from '../api'
import { count } from '../lib/format'
import type { AboutResponse } from '../types'

type Row = Record<string, number | string>

const num = (row: Row, key: string): number | null => {
  const value = Number(row[key])
  return Number.isFinite(value) ? value : null
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The server's likely range holds 80% of cases: 1.2816 standard deviations each way. */
const Z80 = 1.2816

const pct = (value: number | null) => (value === null ? 'no figure' : `${value.toFixed(0)}%`)

const CHARTS: { name: 'before' | 'after' | 'validation'; caption: string }[] = [
  { name: 'before', caption: 'Before correction: the count jumps when the camera changes.' },
  { name: 'after', caption: 'After correction: the two cameras on one footing.' },
  { name: 'validation', caption: 'The hidden-year test: estimated against actually seen.' },
]

/**
 * How the correction works and how far to trust it, from the server's own fitted model
 * and test results. Everything here is the backend's numbers shown as they are; the
 * page adds no claim of its own.
 */
export function Method({ about, onClose }: { about: AboutResponse | null; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    sheet.current?.focus({ preventScroll: true })
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const years = (about?.validation ?? []).filter((r) => num(r, 'year') !== null)
  const circles = about?.circle_validation ?? []
  const before = median(years.map((r) => num(r, 'err_none')).filter((v): v is number => v !== null))
  const after = median(years.map((r) => num(r, 'err_curve')).filter((v): v is number => v !== null))
  const worst = years.reduce<Row | null>(
    (w, r) => ((num(r, 'err_curve') ?? 0) > (w ? num(w, 'err_curve') ?? 0 : -1) ? r : w), null,
  )
  const curves = (about?.model?.by_radius ?? null) as Record<string, { a: number; b: number; sigma: number }> | null
  const fit = about?.model?.fit_months as string[] | undefined

  return (
    <div className="method-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="method surface" role="dialog" aria-modal="true" aria-labelledby="method-title" tabIndex={-1} ref={sheet}>
        <header>
          <div>
            <p className="eyebrow">Method</p>
            <h2 id="method-title">How the two satellite cameras are made comparable</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>

        <div className="method-body">
          <section>
            <h3>The problem</h3>
            <p>
              Fires have been recorded from orbit since November 2000 by an older camera
              (MODIS), and since February 2012 by a sharper one (VIIRS) as well. The sharper
              camera reports several times more detections for the same fire. A raw count
              from 2005 and one from 2024 therefore measure different things.
            </p>
          </section>

          <section>
            <h3>The correction</h3>
            <ol>
              <li>
                Detections are turned into <b>fire activity</b>: the number of 10 km map
                squares with fire, counted once for each day they burned. This depends far
                less on how sharp the camera is than a raw count does.
              </li>
              <li>
                For the months both cameras were flying{fit ? ` (${fit[0]} to ${fit[1]})` : ''},
                the activity each one saw in the same place is compared, and a curve is
                fitted from the older camera's figure to the newer one's.
              </li>
              <li>
                Months before February 2012 are passed through that curve. They are
                <b> estimates</b>, and each carries a likely range. Months from February
                2012 on are <b>measured</b> by the newer camera and are not changed.
              </li>
            </ol>
            {curves && (
              <>
                <p className="formula">estimate = e<sup>a</sup> × (older camera's activity)<sup>b</sup></p>
                <table>
                  <thead><tr><th>Circle</th><th>a</th><th>b</th><th>Likely range</th></tr></thead>
                  <tbody>
                    {Object.entries(curves).map(([km, c]) => (
                      <tr key={km}>
                        <td>{km} km</td>
                        <td>{c.a.toFixed(3)}</td>
                        <td>{c.b.toFixed(3)}</td>
                        <td>÷ {Math.exp(Z80 * c.sigma).toFixed(1)} to × {Math.exp(Z80 * c.sigma).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">
                  The likely range is where 8 estimates in 10 are expected to fall, from
                  the scatter of the fit. It is why an estimate is shown as "between X and
                  Y" and never as a single exact figure.
                </p>
              </>
            )}
          </section>

          {years.length > 0 && (
            <section>
              <h3>Does it work? The hidden-year test</h3>
              <p>
                Each year the newer camera saw is hidden in turn, the curve is fitted on
                the rest, and that year is estimated from the older camera alone. The
                estimate is then set against what the newer camera really recorded,
                across Quebec.
              </p>
              <div className="method-stats">
                <div><span>Typical error, uncorrected</span><b>{pct(before)}</b></div>
                <div><span>Typical error, corrected</span><b>{pct(after)}</b></div>
                <div><span>Years tested</span><b>{years.length}</b></div>
              </div>
              <table>
                <thead>
                  <tr><th>Year</th><th>Seen</th><th>Uncorrected</th><th>Error</th><th>Corrected</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {years.map((r) => (
                    <tr key={String(r.year)}>
                      <td>{String(r.year)}</td>
                      <td>{count(num(r, 'actual') ?? 0)}</td>
                      <td>{count(num(r, 'none') ?? 0)}</td>
                      <td>{pct(num(r, 'err_none'))}</td>
                      <td>{count(num(r, 'curve') ?? 0)}</td>
                      <td className={(num(r, 'err_curve') ?? 0) > (num(r, 'err_none') ?? 0) ? 'is-worse' : ''}>
                        {pct(num(r, 'err_curve'))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {worst && (num(worst, 'err_curve') ?? 0) > (num(worst, 'err_none') ?? 0) && (
                <p className="small muted">
                  The correction is not better every year: in {String(worst.year)} it was
                  further out ({pct(num(worst, 'err_curve'))}) than the uncorrected figure
                  ({pct(num(worst, 'err_none'))}). Years where it did worse are marked.
                </p>
              )}
            </section>
          )}

          {circles.length > 0 && (
            <section>
              <h3>How far to trust one circle</h3>
              <p>
                The same test at the size of the circles on this page. A small area holds
                few fires, so its estimate is much less certain than Quebec's as a whole.
              </p>
              <table>
                <thead>
                  <tr><th>Circle</th><th>Tests</th><th>Typical error, uncorrected</th><th>Typical error, corrected</th><th>Within a factor of two</th></tr>
                </thead>
                <tbody>
                  {circles.map((r) => (
                    <tr key={String(r.radius_km)}>
                      <td>{String(r.radius_km)} km</td>
                      <td>{count(num(r, 'circle_years') ?? 0)}</td>
                      <td>{pct(num(r, 'median_err_none'))}</td>
                      <td>{pct(num(r, 'median_err_curve'))}</td>
                      <td>{pct(num(r, 'within_2x_curve'))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">
                Read a single circle's estimate before 2012 as a rough size, good to about
                a factor of two, and use a larger circle or a longer period for anything
                that matters.
              </p>
            </section>
          )}

          <section>
            <h3>Experimental spread forecast</h3>
            <p>
              In the operational view, a model learned from past Quebec fires gives the
              chance that fire is seen within 2 km of the chosen point over the next
              three days. Tested on 2023, a season the model never saw. A warning zone
              covering the closest 2% of the area caught 40% of next-day fire spread,
              against 35% for simply picking the squares nearest the fire.
            </p>
            <p className="small muted">
              It is a likelihood for a place, not a map of where a fire will go. It does
              not know about firefighting, lakes, roads or fuel type.
            </p>
          </section>

          <section>
            <h3>What this cannot tell you</h3>
            <ul>
              <li>It is valid for an area over a month or longer, never for one detection or one day.</li>
              <li>Before July 2002 only one satellite carried the older camera, so even less was seen.</li>
              <li>A satellite sees heat through gaps in cloud and smoke. No detection is not proof of no fire.</li>
              <li>Fire intensity is measured as it is and is not corrected. Raw detections are never compared across 2012.</li>
              <li>It is a record of the past. It does not show where a fire is now or where one will spread.</li>
            </ul>
          </section>

          <section className="method-charts">
            {CHARTS.map((chart) => <Chart key={chart.name} {...chart} />)}
          </section>

          <p className="small muted">Fire data: NASA FIRMS (MODIS, VIIRS).</p>
        </div>
      </div>
    </div>
  )
}

/** One of the server's ready-made charts. Drawn only if the server has it. */
function Chart({ name, caption }: { name: 'before' | 'after' | 'validation'; caption: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return null
  return (
    <figure>
      <img src={chartUrl(name)} alt={caption} loading="lazy" onError={() => setMissing(true)} />
      <figcaption className="small muted">{caption}</figcaption>
    </figure>
  )
}
