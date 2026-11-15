import { formatDate } from '../lib/days'
import type { QueryState } from '../hooks/useSelectionQuery'
import type { OutlookResponse } from '../types'

const WORDS: Record<'low' | 'usual' | 'high', string> = {
  low: 'Quieter than usual',
  usual: 'About usual',
  high: 'Busier than usual',
}

/**
 * How fire-prone the coming fortnight usually is here. It is never a forecast of where a
 * fire will spread, and the page has to say so: nothing is drawn on the map for it.
 */
export function Outlook({ state }: { state: QueryState<OutlookResponse> }) {
  if (state.status === 'error' || state.status === 'idle') return null
  if (state.status !== 'ready') {
    return <section className="outlook"><h3>Outlook</h3><p className="muted small">Looking at past seasons…</p></section>
  }
  const data: OutlookResponse = state.data
  if (!data.level && !data.reasons.length) return null

  return (
    <section className="outlook">
      <h3>{data.label}</h3>
      {data.level
        ? (
          <p className={`level level-${data.level}`}>
            <span className="level-word">{WORDS[data.level]}</span>
            <span className="small">
              {formatDate(data.window.from)} to {formatDate(data.window.to)}
            </span>
          </p>
        )
        : null}
      <ul className="reasons">
        {data.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <p className="small muted">
        Worked out from past seasons at this place and recent weather. It is not a
        prediction of where a fire will spread.
      </p>
    </section>
  )
}
