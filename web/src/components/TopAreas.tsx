import { useEffect, useState } from 'react'
import { count, megawatts } from '../lib/format'
import { nameNear } from '../places'
import type { QueryState } from '../hooks/useSelectionQuery'
import type { TopArea, TopAreasResponse } from '../types'

export interface TopAreasProps {
  state: QueryState<TopAreasResponse>
  onPick: (lat: number, lon: number, name: string) => void
}

const coords = (area: TopArea) => `${area.lat.toFixed(2)}, ${area.lon.toFixed(2)}`

/** Names for the ranked squares, filled in as each lookup lands. */
function useNames(areas: TopArea[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    for (const area of areas) {
      void nameNear(area.lat, area.lon).then((name) => {
        if (live && name) setNames((now) => ({ ...now, [coords(area)]: name }))
      })
    }
    return () => { live = false }
  }, [areas])
  return names
}

const TITLE = 'Hardest-hit areas'

/** The 10 km squares with the most fire in the chosen months, worst first. */
export function TopAreas({ state, onPick }: TopAreasProps) {
  const areas = state.status === 'ready' ? state.data.areas : NONE
  const names = useNames(areas)

  if (state.status === 'error') {
    return <section className="top-areas"><h3>{TITLE}</h3><p className="warn-box">{state.detail}</p></section>
  }
  if (state.status !== 'ready') {
    return <section className="top-areas"><h3>{TITLE}</h3><div className="skeleton" role="status" aria-label="Ranking areas"><i className="sk sk-block" style={{ height: 300 }} /></div></section>
  }
  if (!areas.length) {
    return (
      <section className="top-areas">
        <h3>{TITLE}</h3>
        <p className="muted small">No detections in the region in this period.</p>
      </section>
    )
  }

  const sensor = areas[0].sensor
  return (
    <section className="top-areas">
      <h3>{TITLE}</h3>
      <p className="small muted area-cols"><span>Total fire power</span></p>
      <ol className="area-list">
        {areas.map((area, index) => {
          const name = names[coords(area)]
          return (
            <li key={coords(area)}>
              <button type="button" onClick={() => onPick(area.lat, area.lon, name ?? coords(area))}>
                <span className="rank">{index + 1}</span>
                <span className="where">
                  <span className="where-name">{name ?? coords(area)}</span>
                  {name && <span className="where-coords">{coords(area)}</span>}
                </span>
                <span className="amount">
                  {megawatts(area.sum_frp)}
                  <span className="small muted">{count(area.detections)} detections</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="small muted">
        10 km squares across the region, chosen period, {sensor} only. Numbered on the map.
      </p>
    </section>
  )
}

const NONE: TopArea[] = []
