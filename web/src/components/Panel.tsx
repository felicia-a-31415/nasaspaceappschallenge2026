import type { PanelAnswer, PanelState } from '../hooks/usePanel'
import type { QueryState } from '../hooks/useSelectionQuery'
import { formatDate, isMonthEnd } from '../lib/days'
import { count, megawatts, position } from '../lib/format'
import { hasAnswer } from '../types'
import type {
  ActivityResponse, Coverage, HotspotArrays, Selection, StatsResponse, TopAreasResponse,
} from '../types'
import type { View } from '../view'
import { ActivityChart } from './ActivityChart'
import { Downloads } from './Downloads'
import { Outlook } from './Outlook'
import { TopAreas } from './TopAreas'

export interface PanelProps {
  view: View
  selection: Selection | null
  placeName: string | null
  panel: PanelState
  topAreas: QueryState<TopAreasResponse>
  hotspots: HotspotArrays | null
  onPick: (lat: number, lon: number, name: string | null) => void
  /** The map's canvas, for the image export. */
  getCanvas: () => HTMLCanvasElement | null
}

/**
 * The inspector. It is one object: a new area swaps the whole of it once, through a
 * skeleton laid out like the answer, rather than section by section as requests land.
 * The operational view has a board of its own (components/ops).
 */
export function Panel(props: PanelProps) {
  const { selection, panel, topAreas, onPick } = props

  return (
    <>
      {!selection && (
        <div className="prompt">
          <h2>No area selected</h2>
          <p className="muted">Click the map, search a place, or enter <span className="num">lat, lon</span>.</p>
        </div>
      )}

      {selection && !panel.answer && <Skeleton />}

      {selection && panel.answer && (
        // Keyed by place, so a new place is one entrance, not a patchwork of updates.
        <div className={`panel-body ${panel.pending ? 'is-pending' : ''}`} key={panel.answer.place} aria-busy={panel.pending}>
          <Answer {...props} selection={selection} answer={panel.answer} />
        </div>
      )}

      <TopAreas state={topAreas} onPick={onPick} />
    </>
  )
}

function Answer({ selection, placeName, answer, hotspots, getCanvas }: PanelProps & {
  selection: Selection
  answer: PanelAnswer
}) {
  const activity = answer.activity.ok ? answer.activity.data : null
  const stats = answer.stats.ok ? answer.stats.data : null
  const where = position(selection.lat, selection.lon)

  return (
    <>
      <header className="place">
        <h2>{placeName ?? where}</h2>
        <p className="place-sub">
          Within {selection.radius_km} km · {selection.from && selection.to ? monthSpan(selection.from, selection.to) : 'full record'}
        </p>
      </header>

      {!answer.activity.ok && <p className="warn-box" role="alert">{answer.activity.detail}</p>}
      {!answer.stats.ok && answer.stats.detail !== (answer.activity.ok ? null : answer.activity.detail) && (
        <p className="warn-box" role="alert">{answer.stats.detail}</p>
      )}
      {activity && <CoverageNote coverage={activity.coverage} progress={activity.progress} detail={activity.detail} />}

      {activity && hasAnswer(activity.coverage) && <Finding activity={activity} selection={selection} />}
      {stats && hasAnswer(stats.coverage) && <Measured stats={stats} />}
      {/* The outlook lands after the rest (it waits on weather); hold its place. */}
      {answer.outlook === null
        ? (
          <section className="outlook is-loading" aria-busy="true">
            <h3>Outlook, next 14 days</h3>
            <div className="skeleton" role="status" aria-label="Computing the outlook"><i className="sk sk-block" style={{ height: 72 }} /></div>
          </section>
        )
        : answer.outlook.ok ? <Outlook data={answer.outlook.data} /> : null}
      <Downloads selection={selection} hotspots={hotspots} getCanvas={getCanvas} />
    </>
  )
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2023-05", "2023-08" reads "May – Aug 2023"; one month reads "Jun 2023". */
export function monthSpan(from: string, to: string): string {
  const name = (m: string) => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
  if (from === to) return name(from)
  if (from.slice(0, 4) === to.slice(0, 4)) return `${MONTH_SHORT[Number(from.slice(5, 7)) - 1]} – ${name(to)}`
  return `${name(from)} – ${name(to)}`
}

function ratioText(ratio: number): string {
  if (ratio >= 100) return 'Over 100×'
  return `${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}×`
}

/** The ratio in a word, and the tone the figure is set in. */
function verdict(ratio: number): { tone: 'far' | 'high' | 'near' | 'low'; word: string } {
  if (ratio >= 5) return { tone: 'far', word: 'Far above normal' }
  if (ratio >= 1.5) return { tone: 'high', word: 'Above normal' }
  if (ratio > 0.67) return { tone: 'near', word: 'Near normal' }
  return { tone: 'low', word: 'Below normal' }
}

function ordinal(n: number): string {
  const tail = n % 100
  if (tail >= 11 && tail <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** One tick per year compared, highest first; this period's place among them is lit. */
function RankStrip({ rank, total }: { rank: number; total: number }) {
  return (
    <div className="rank">
      <div className="rank-ticks" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <i key={i} className={i + 1 === rank ? 'is-here' : ''} />)}
      </div>
      <p>{rank === 1 ? 'Highest' : `${ordinal(rank)} highest`} of {total} years</p>
    </div>
  )
}

/** How much fire the period held against what is usual for the same months. */
function Finding({ activity, selection }: { activity: ActivityResponse; selection: Selection }) {
  // The record stops part-way through the current month, and a part month is never
  // compared with whole ones, so the comparison can cover less than the chosen range.
  const unfinished = unfinishedMonth(activity)
  const { summary } = activity
  const tone = summary?.ratio != null ? verdict(summary.ratio) : null

  return (
    <section className="finding" aria-label="Fire activity against what is usual">
      <div className={`hero ${tone ? `tone-${tone.tone}` : ''}`}>
        <h3>Fire activity</h3>
        {summary
          ? (
            <>
              {summary.ratio !== null && tone
                ? (
                  <>
                    <p className="hero-figure">
                      <b>{ratioText(summary.ratio)}</b>
                      <span>the usual for these months</span>
                    </p>
                    <p className="hero-word"><i />{tone.word}</p>
                  </>
                )
                // A baseline of zero has no ratio. Say what was seen instead of dividing by it.
                : (
                  <p className="hero-plain">
                    {summary.total > 0
                      ? 'Fire was seen here in months that usually have none.'
                      : 'No fire in these months, which is usual here.'}
                  </p>
                )}
              {summary.total > 0 && <RankStrip rank={summary.rank} total={summary.years_compared + 1} />}
              {unfinished && endsAfter(summary, unfinished) && (
                <p className="small muted">{unfinished} is still in progress and left out.</p>
              )}
            </>
          )
          : (
            <p className="hero-plain">
              {unfinished && selection.from === unfinished
                ? 'This month is still in progress, so there is nothing to compare it with yet. Extend the period to an earlier month.'
                : 'Not enough history here for a comparison.'}
            </p>
          )}
      </div>
      <ActivityChart months={activity.months} />
    </section>
  )
}

/** The month the record is still part way through, if the answer reaches it. */
function unfinishedMonth(answer: ActivityResponse): string | null {
  if (!answer.data_through || isMonthEnd(answer.data_through)) return null
  const month = answer.data_through.slice(0, 7)
  return answer.months.some((m) => m.month === month) ? month : null
}

/** Does the summary stop before `month`? */
function endsAfter(summary: NonNullable<ActivityResponse['summary']>, month: string): boolean {
  const last = `${summary.year}-${String(summary.months[summary.months.length - 1]).padStart(2, '0')}`
  return last < month
}

/** Where the answer came from, and what is still happening if it is not ready. */
function CoverageNote({ coverage, progress, detail }: {
  coverage: Coverage
  progress: number | null
  detail: string | null
}) {
  if (coverage === 'partial') {
    return <p className="small note-box">Area partly outside the archive extent. Only the covered part is counted.</p>
  }
  if (coverage === 'queued' || coverage === 'fetching') {
    return (
      <p className="small note-box" role="status">
        Retrieving FIRMS archive for this area{progress !== null ? `: ${Math.round(progress * 100)}%` : '…'}
      </p>
    )
  }
  if (coverage === 'outside') {
    return <p className="note-box">{detail ?? 'No archive coverage for this area.'}</p>
  }
  return null
}

/** What the satellites saw in the area and period. */
function Measured({ stats }: { stats: StatsResponse }) {
  if (stats.detections === 0) {
    return (
      <section className="measured">
        <h3>Detections</h3>
        <p className="note-box">No fire was detected in this area and period.</p>
      </section>
    )
  }
  return (
    <section className="measured">
      <h3>Detections</h3>
      <dl className="stats">
        <div><dt>Fire detections</dt><dd>{count(stats.detections)}</dd></div>
        <div><dt>Total fire power</dt><dd>{megawatts(stats.sum_frp)}</dd></div>
        {stats.peak_day && (
          <div className="stats-wide">
            <dt>Busiest day</dt>
            <dd>{formatDate(stats.peak_day.date)}<span>{count(stats.peak_day.detections)} detections</span></dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/** Grey blocks where the answer will be, laid out like the answer, so nothing jumps. */
function Skeleton() {
  return (
    <div className="skeleton" role="status" aria-label="Querying the archive">
      <div className="sk-group">
        <i className="sk sk-line" style={{ width: '34%' }} />
        <i className="sk sk-title" style={{ width: '62%' }} />
        <i className="sk sk-line" style={{ width: '48%' }} />
      </div>
      <div className="sk-group">
        <i className="sk sk-line" style={{ width: '40%' }} />
        <i className="sk sk-head" style={{ width: '70%' }} />
        <i className="sk sk-line" /><i className="sk sk-line" style={{ width: '70%' }} />
      </div>
      <div className="sk-grid">
        <i className="sk sk-figure" /><i className="sk sk-figure" /><i className="sk sk-figure" /><i className="sk sk-figure" />
      </div>
      <i className="sk sk-block" style={{ height: 118 }} />
    </div>
  )
}
