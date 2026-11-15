import { count, megawatts } from '../lib/format'
import type { QueryState } from '../hooks/useSelectionQuery'
import type { TopAreasResponse } from '../types'

export interface TopAreasProps {
  state: QueryState<TopAreasResponse>
  onPick: (lat: number, lon: number, name: string) => void
}

/** The 10 km squares with the most fire in the chosen months, worst first. */
export function TopAreas({ state, onPick }: TopAreasProps) {
  if (state.status === 'error') {
    return <section className="top-areas"><h3>Top 10 cells by ΣFRP</h3><p className="warn-box">{state.detail}</p></section>
  }
  if (state.status !== 'ready') {
    return <section className="top-areas"><h3>Top 10 cells by ΣFRP</h3><div className="skeleton" role="status" aria-label="Ranking cells"><i className="sk sk-block" style={{ height: 300 }} /></div></section>
  }
  const { areas } = state.data
  if (!areas.length) {
    return (
      <section className="top-areas">
        <h3>Top 10 cells by ΣFRP</h3>
        <p className="muted small">0 detections in the region in this period.</p>
      </section>
    )
  }

  const sensor = areas[0].sensor
  return (
    <section className="top-areas">
      <h3>Top 10 cells by ΣFRP</h3>
      <ol className="area-list">
        {areas.map((area, index) => (
          <li key={`${area.lat},${area.lon}`}>
            <button type="button" onClick={() => onPick(area.lat, area.lon, `Cell ${area.lat.toFixed(2)}, ${area.lon.toFixed(2)}`)}>
              <span className="rank">{index + 1}</span>
              <span className="where">{area.lat.toFixed(2)}, {area.lon.toFixed(2)}</span>
              <span className="amount">
                {megawatts(area.sum_frp)}
                <span className="small muted">n = {count(area.detections)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="small muted">
        0.1° cells, whole region, chosen period. Measured; {sensor} only, so the ranking
        never mixes sensors. Numbered on the map.
      </p>
    </section>
  )
}
