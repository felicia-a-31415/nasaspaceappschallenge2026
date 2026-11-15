import { SWITCH_MONTH } from '../lib/days'
import { CELL_DEG } from '../lib/geo'
import { count } from '../lib/format'
import type { AboutResponse, Selection } from '../types'

type Row = Record<string, number | string>
type Curve = { a: number; b: number; sigma: number }

/** The server's interval holds 80% of cases: 1.2816 standard deviations each way. */
const Z80 = 1.2816

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Which sensors observed the period, from the transition month. */
function sensorsFor(selection: Selection | null): string {
  if (!selection?.from || !selection.to) return 'MODIS + VIIRS (harmonized)'
  if (selection.to < SWITCH_MONTH) return 'MODIS (converted to VIIRS scale)'
  if (selection.from >= SWITCH_MONTH) return 'VIIRS'
  return 'MODIS + VIIRS (harmonized)'
}

/**
 * Where the numbers come from and how far to trust them: sources, harmonization
 * parameters, the overlap-period fit, and its validation. All figures are the server's.
 */
export function Provenance({ about, selection, dataThrough, onMethod }: {
  about: AboutResponse | null
  selection: Selection | null
  dataThrough?: string
  onMethod: () => void
}) {
  const model = about?.model as { fit_months?: string[]; by_radius?: Record<string, Curve>; a?: number; b?: number; sigma?: number } | undefined
  const curve: Curve | null = selection && model?.by_radius?.[String(selection.radius_km)]
    || (model && typeof model.a === 'number' ? { a: model.a, b: model.b ?? 1, sigma: model.sigma ?? 0 } : null)
  const years = ((about?.validation ?? []) as Row[]).filter((r) => Number.isFinite(Number(r.year)))
  const before = median(years.map((r) => Number(r.err_none)))
  const after = median(years.map((r) => Number(r.err_curve)))
  const circle = selection
    ? ((about?.circle_validation ?? []) as Row[]).find((r) => Number(r.radius_km) === selection.radius_km)
    : undefined

  return (
    <section className="provenance" aria-label="Data provenance">
      <h3>Provenance</h3>
      <dl className="kv">
        <div><dt>Active sensors</dt><dd>{sensorsFor(selection)}</dd></div>
        <div><dt>MODIS</dt><dd>C6.1 · Terra, Aqua · 1 km · 2000-11 → 2012-01</dd></div>
        <div><dt>VIIRS</dt><dd>C2 · S-NPP, NOAA-20 · 375 m · {SWITCH_MONTH} →</dd></div>
        <div><dt>Source</dt><dd>NASA FIRMS archive + NRT{dataThrough ? ` · through ${dataThrough}` : ''}</dd></div>
        <div><dt>Grid</dt><dd>{CELL_DEG}° × {CELL_DEG}° · 1 day</dd></div>
        <div><dt>Metric</dt><dd>cell-days (cells with ≥ 1 detection, per day)</dd></div>
      </dl>

      {curve && (
        <>
          <h4>Overlap calibration{model?.fit_months ? ` · ${model.fit_months[0]} → ${model.fit_months[1]}` : ''}</h4>
          <p className="formula">ln V = a + b · ln M</p>
          <dl className="kv">
            <div><dt>Scope</dt><dd>{selection ? `R ${selection.radius_km} km areas` : 'region'}</dd></div>
            <div><dt>a</dt><dd>{curve.a.toFixed(3)}</dd></div>
            <div><dt>b</dt><dd>{curve.b.toFixed(3)}</dd></div>
            <div><dt>σ (ln)</dt><dd>{curve.sigma.toFixed(3)}</dd></div>
            <div><dt>80% interval</dt><dd>× / ÷ {Math.exp(Z80 * curve.sigma).toFixed(2)}</dd></div>
          </dl>
        </>
      )}

      {(years.length > 0 || circle) && (
        <>
          <h4>Validation · leave-one-year-out</h4>
          <dl className="kv">
            {years.length > 0 && after !== null && before !== null && (
              <div><dt>Region, median |err|</dt><dd>{after.toFixed(1)}% (uncorrected {before.toFixed(1)}%) · n = {years.length} yr</dd></div>
            )}
            {circle && (
              <>
                <div>
                  <dt>R {String(circle.radius_km)} km, median |err|</dt>
                  <dd>{Number(circle.median_err_curve).toFixed(1)}% (uncorrected {Number(circle.median_err_none).toFixed(1)}%)</dd>
                </div>
                <div><dt>Within factor 2</dt><dd>{Number(circle.within_2x_curve).toFixed(1)}% · n = {count(Number(circle.circle_years))} area-years</dd></div>
              </>
            )}
          </dl>
        </>
      )}

      <button type="button" className="link" onClick={onMethod}>Method and validation</button>
    </section>
  )
}
