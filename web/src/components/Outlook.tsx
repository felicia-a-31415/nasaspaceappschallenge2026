import { formatDate } from '../lib/days'
import type { OutlookResponse } from '../types'

const WORDS: Record<'low' | 'usual' | 'high', string> = {
  low: 'Quieter than usual',
  usual: 'About usual',
  high: 'Busier than usual',
}

/**
 * How fire-prone the coming fortnight usually is here, under the server's own label. It
 * is a likelihood for a place from past seasons, never where a fire will spread, and the
 * page has to say so: nothing is drawn on the map for it. The level is words first; the
 * mark beside it only repeats them.
 */
export function Outlook({ data, raised = false, brief = false }: {
  data: OutlookResponse
  raised?: boolean
  /** Only the level, for the small card. */
  brief?: boolean
}) {
  if (!data.level && !data.reasons.length) return null
  if (brief && !data.level) return null

  return (
    <section className={`outlook ${raised ? 'is-raised' : ''}`}>
      <h3>{data.label}</h3>
      {data.level && (
        <p className={`level level-${data.level}`}>
          <span className="level-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="level-word">{WORDS[data.level]}</span>
          <span className="small muted">
            for {formatDate(data.window.from)} to {formatDate(data.window.to)}, worked out
            on {formatDate(data.as_of)}
          </span>
        </p>
      )}
      {!brief && (
        <>
          <ul className="reasons">
            {data.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p className="small muted">
            Worked out from past seasons at this place and recent weather. It says how these
            two weeks usually go here. It does not say where a fire is or where one will spread.
          </p>
        </>
      )}
    </section>
  )
}
