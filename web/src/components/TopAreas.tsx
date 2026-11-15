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
    return <section className="top-areas"><h3>Hardest hit squares</h3><p className="warn-box">{state.detail}</p></section>
  }
  if (state.status !== 'ready') {
    return <section className="top-areas"><h3>Hardest hit squares</h3><p className="muted small">Working them out…</p></section>
  }
  const { areas } = state.data
  if (!areas.length) {
    return (
      <section className="top-areas">
        <h3>Hardest hit squares</h3>
        <p className="muted small">No fire was detected anywhere in Quebec in this period.</p>
      </section>
    )
  }

  const camera = areas[0].sensor === 'VIIRS' ? 'newer' : 'older'
  return (
    <section className="top-areas">
      <h3>Hardest hit squares</h3>
      <ol className="area-list">
        {areas.map((area, index) => (
          <li key={`${area.lat},${area.lon}`}>
            <button type="button" onClick={() => onPick(area.lat, area.lon, `Square ${index + 1}, ${area.lat}, ${area.lon}`)}>
              <span className="rank">{index + 1}</span>
              <span className="where">{area.lat.toFixed(2)}, {area.lon.toFixed(2)}</span>
              <span className="amount">
                {megawatts(area.sum_frp)}
                <span className="small muted"> · {count(area.detections)} detections</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="small muted">
        Squares about 10 km across, ranked by total fire intensity, all from the {camera}{' '}
        camera so the ranking never mixes the two. Click one to look at it.
      </p>
    </section>
  )
}
