import { getActivity, getStats } from '../api'
import { useSelectionQuery } from '../hooks/useSelectionQuery'
import { formatDate, formatMonth } from '../lib/days'
import { coordinates, count, megawatts, times } from '../lib/format'
import { hasAnswer } from '../types'
import type { ActivityResponse, Coverage, Selection, StatsResponse } from '../types'
import { YearChart } from './YearChart'

export interface StatsPanelProps {
  selection: Selection
  placeName: string | null
}

export function StatsPanel({ selection, placeName }: StatsPanelProps) {
  const activity = useSelectionQuery(selection, (sel, signal) => getActivity(sel, signal))
  const stats = useSelectionQuery(selection, (sel, signal) => getStats(sel, signal))

  const answer = activity.status === 'ready' ? activity.data : null
  const numbers = stats.status === 'ready' ? stats.data : null

  return (
    <section className="stats" aria-label="What burned here">
      <header className="stats-head">
        <h2>{placeName ?? coordinates(selection.lat, selection.lon)}</h2>
        <p className="small muted">
          {placeName ? `${coordinates(selection.lat, selection.lon)} · ` : ''}
          Within {selection.radius_km} km
          {selection.from && selection.to
            ? ` · ${selection.from === selection.to
              ? formatMonth(selection.from)
              : `${formatMonth(selection.from)} to ${formatMonth(selection.to)}`}`
            : ''}
        </p>
      </header>

      {activity.status === 'error' && <p className="warn-box" role="alert">{activity.detail}</p>}
      {(activity.status === 'loading' || (activity.status === 'idle' && !answer)) && (
        <p className="muted small">Working out what burned here…</p>
      )}

      {answer && <CoverageNote coverage={answer.coverage} progress={answer.progress} detail={answer.detail} />}

      {answer?.summary && (
        <p className="headline">{answer.summary.sentence}</p>
      )}
      {answer && !answer.summary && hasAnswer(answer.coverage) && (
        <p className="headline muted">
          There is too little history here to say whether this is more fire than usual.
        </p>
      )}
      {answer && <EstimatedNote answer={answer} />}

      {numbers && hasAnswer(numbers.coverage) && (
        numbers.detections === 0
          ? (
            <p className="muted">
              No fire was detected here in this period. That is a real answer, not a gap in
              the record.
            </p>
          )
          : <RawNumbers numbers={numbers} />
      )}
      {stats.status === 'error' && <p className="warn-box" role="alert">{stats.detail}</p>}
    </section>
  )
}

/** Where the answer came from, and what is still happening if it is not ready. */
function CoverageNote({ coverage, progress, detail }: {
  coverage: Coverage
  progress: number | null
  detail: string | null
}) {
  if (coverage === 'preloaded') return null
  if (coverage === 'partial') {
    return (
      <p className="small note-box">
        Part of this circle is outside the area with fire records. Only the part inside is counted.
      </p>
    )
  }
  if (coverage === 'queued' || coverage === 'fetching') {
    return (
      <p className="small note-box" role="status">
        Fetching this place&rsquo;s fire history from NASA
        {progress !== null ? ` — ${Math.round(progress * 100)}% done` : '…'}. The numbers
        will appear here when it arrives.
      </p>
    )
  }
  if (coverage === 'outside') {
    return <p className="muted">{detail ?? 'There is no fire history for this place.'}</p>
  }
  return null
}

/** Months before February 2012 are lifted from the older camera, and must say so. */
function EstimatedNote({ answer }: { answer: ActivityResponse }) {
  const estimated = answer.months.filter((m) => m.estimated)
  if (!estimated.length) return null
  const low = estimated.reduce((sum, m) => sum + m.low, 0)
  const high = estimated.reduce((sum, m) => sum + m.high, 0)
  const terra = answer.months.some((m) => m.terra_only)
  return (
    <p className="small estimated-box">
      {estimated.length === answer.months.length ? 'This period is' : `${estimated.length} of these months are`}
      {' '}before February 2012, so the fire activity is an estimate lifted from the older
      camera: likely between {count(low)} and {count(high)}.
      {terra && ' Before July 2002 only one satellite was flying, so even less was seen.'}
    </p>
  )
}

/** Raw detections and intensity: measured, never corrected, never compared across 2012. */
function RawNumbers({ numbers }: { numbers: StatsResponse }) {
  const { this_year: now, typical_year: usual } = numbers
  return (
    <>
      <dl className="figures">
        <div>
          <dt>Fire detections</dt>
          <dd>{count(numbers.detections)}</dd>
        </div>
        <div>
          <dt>Average intensity</dt>
          <dd>{megawatts(numbers.mean_frp)}</dd>
        </div>
        <div>
          <dt>Total intensity</dt>
          <dd>{megawatts(numbers.sum_frp)}</dd>
        </div>
        <div>
          <dt>Busiest day</dt>
          <dd>
            {numbers.peak_day
              ? <>{formatDate(numbers.peak_day.date)}<span className="small muted peak-count">{count(numbers.peak_day.detections)} detections</span></>
              : '—'}
          </dd>
        </div>
      </dl>
      <p className="small muted figures-note">
        One large fire is thousands of detections, so these count detections, not fires.
        Measured, not corrected.
      </p>

      {now && (
        <p className="this-year">
          <strong>{now.year} so far:</strong> {count(now.detections)} detections
          {usual
            ? <> — {times(usual.detections ? now.detections / usual.detections : 0)} a typical
              year here ({count(usual.detections)} detections, the middle of {usual.years} years
              seen by the same camera).</>
            : '.'}
        </p>
      )}

      <YearChart years={numbers.by_year} />
    </>
  )
}
