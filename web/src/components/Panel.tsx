import type { ReactNode } from 'react'
import type { PanelAnswer, PanelState } from '../hooks/usePanel'
import type { QueryState } from '../hooks/useSelectionQuery'
import { isMonthEnd, periodLabel, SWITCH_MONTH } from '../lib/days'
import { count, megawatts, position } from '../lib/format'
import { hasAnswer } from '../types'
import type {
  AboutResponse, ActivityResponse, Coverage, HotspotArrays, Selection, StatsResponse, TopAreasResponse,
  WeatherResponse,
} from '../types'
import type { View } from '../view'
import { ActivityChart } from './ActivityChart'
import { Downloads } from './Downloads'
import { Outlook } from './Outlook'
import { TopAreas } from './TopAreas'
import { WeatherStrip } from './WeatherStrip'
import { YearChart } from './YearChart'

export interface PanelProps {
  view: View
  selection: Selection | null
  placeName: string | null
  panel: PanelState
  weather: QueryState<WeatherResponse>
  topAreas: QueryState<TopAreasResponse>
  about: AboutResponse | null
  hotspots: HotspotArrays | null
  /** The last day the record holds, YYYY-MM-DD. */
  dataThrough?: string
  onPick: (lat: number, lon: number, name: string | null) => void
  /** Open the sheet that documents and validates the harmonization. */
  onMethod: () => void
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

function Answer({ selection, placeName, answer, weather, hotspots, onMethod, getCanvas }: PanelProps & {
  selection: Selection
  answer: PanelAnswer
}) {
  const activity = answer.activity.ok ? answer.activity.data : null
  const stats = answer.stats.ok ? answer.stats.data : null

  const where = position(selection.lat, selection.lon)
  const head = (
    <header className="place">
      <h2>{placeName ?? where}</h2>
      <p className="place-sub">
        {placeName ? `${where} · ` : ''}{selection.radius_km} km radius · {selection.from && selection.to ? monthSpan(selection.from, selection.to) : 'full record'}
      </p>
    </header>
  )

  const problems = (
    <>
      {!answer.activity.ok && <p className="warn-box" role="alert">{answer.activity.detail}</p>}
      {!answer.stats.ok && answer.stats.detail !== (answer.activity.ok ? null : answer.activity.detail) && (
        <p className="warn-box" role="alert">{answer.stats.detail}</p>
      )}
      {activity && <CoverageNote coverage={activity.coverage} progress={activity.progress} detail={activity.detail} />}
    </>
  )

  const finding = activity && hasAnswer(activity.coverage) && (
    <Finding activity={activity} selection={selection} onMethod={onMethod} />
  )
  const measured = stats && hasAnswer(stats.coverage) && <Measured stats={stats} />
  // The outlook lands after the rest (it waits on NASA POWER weather); hold its place.
  const outlook = answer.outlook === null
    ? (
      <section className="outlook is-loading" aria-busy="true">
        <h3>Outlook, next 14 days</h3>
        <p className="small muted">Retrieving NASA POWER weather…</p>
      </section>
    )
    : answer.outlook.ok ? <Outlook data={answer.outlook.data} /> : null
  const years = stats && hasAnswer(stats.coverage) && stats.detections > 0 && <YearChart years={stats.by_year} />
  const tail = (
    <>
      <Downloads selection={selection} hotspots={hotspots} getCanvas={getCanvas} />
    </>
  )

  return <>{head}{problems}{finding}{measured}{years}{outlook}<WeatherStrip state={weather} />{tail}</>
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2023-05", "2023-08" reads "May 2023 → Aug 2023"; one month reads "Jun 2023". */
export function monthSpan(from: string, to: string): string {
  const name = (m: string) => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
  return from === to ? name(from) : `${name(from)} → ${name(to)}`
}

/** What kind of number follows: harmonized, measured, or estimated. */
function Kind({ kind, children }: { kind: 'measured' | 'estimate' | 'corrected'; children: ReactNode }) {
  return <span className={`kind kind-${kind}`}>{children}</span>
}

function ratioText(ratio: number): string {
  return `${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}×`
}

/** The scale runs from a tenth of the baseline to two hundred times it, in logarithms. */
const SCALE_MIN = -1
const SCALE_MAX = Math.log10(200)
const scaleAt = (ratio: number) => (Math.log10(ratio) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100

/** Where the period sits against its baseline, on a log scale with the baseline at 1×. */
function RatioScale({ ratio }: { ratio: number }) {
  const at = Math.min(100, Math.max(0, scaleAt(Math.max(ratio, 0.001))))
  return (
    <div className="ratio-scale" role="img" aria-label={`${ratioText(ratio)} the baseline, on a scale from one tenth to two hundred times`}>
      <div className="ratio-track"><i style={{ left: `${at}%` }} /></div>
      <div className="ratio-ticks">
        {[[0.1, '÷10'], [1, 'baseline'], [10, '×10'], [100, '×100']].map(([value, label]) => (
          <span key={label} style={{ left: `${scaleAt(value as number)}%` }}>{label}</span>
        ))}
      </div>
    </div>
  )
}

/** One tick per year compared, highest first; this period's place among them is lit. */
function RankStrip({ rank, total }: { rank: number; total: number }) {
  return (
    <div className="rank">
      <div className="rank-ticks" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <i key={i} className={i + 1 === rank ? 'is-here' : ''} />)}
      </div>
      <p><b>{rank}</b> of {total} years, highest first</p>
    </div>
  )
}

/** Harmonized activity against its baseline: the one quantity comparable across 2012. */
function Finding({ activity, selection, onMethod }: {
  activity: ActivityResponse
  selection: Selection
  onMethod: () => void
}) {
  // The record stops part-way through the current month, and a part month is never
  // compared with whole ones, so the comparison can cover less than the chosen range.
  const unfinished = unfinishedMonth(activity)
  const { summary } = activity
  const estimated = activity.months.filter((m) => m.estimated)
  const low = estimated.reduce((sum, m) => sum + m.low, 0)
  const high = estimated.reduce((sum, m) => sum + m.high, 0)

  return (
    <section className="finding" aria-label="Harmonized fire activity against baseline">
      <h3>Fire activity <Kind kind="corrected">harmonized</Kind></h3>
      {summary
        ? (
          <>
            {summary.ratio !== null
              ? (
                <>
                  <p className="headline">
                    <b>{ratioText(summary.ratio)}</b>
                    <span>the median of the same months in {summary.years_compared} other years</span>
                  </p>
                  <RatioScale ratio={summary.ratio} />
                </>
              )
              // A baseline of zero has no ratio. Say what was seen instead of dividing by it.
              : (
                <p className="note-box">
                  {summary.total > 0
                    ? `Baseline median is 0 cell-days over ${summary.years_compared} years, so no ratio is defined.`
                    : `No fire activity in these months, and none in the median of ${summary.years_compared} other years.`}
                </p>
              )}
            {summary.total > 0 && <RankStrip rank={summary.rank} total={summary.years_compared + 1} />}
            <dl className="kv">
              <div><dt>{periodLabel(summary.year, summary.months)}</dt><dd>{count(summary.total)} cell-days</dd></div>
              <div><dt>Baseline median</dt><dd>{count(summary.median)} cell-days</dd></div>
            </dl>
            {unfinished && endsAfter(summary, unfinished) && (
              <p className="small muted">{unfinished} is incomplete and excluded.</p>
            )}
          </>
        )
        : (
          <p className="note-box">
            {unfinished && selection.from === unfinished
              ? `${unfinished} is incomplete; no baseline comparison. Extend the period to an earlier month.`
              : 'Insufficient history for a baseline comparison.'}
          </p>
        )}
      {estimated.length > 0
        ? (
          <p className="small kind-line">
            <Kind kind="estimate">estimated</Kind>{' '}
            {estimated.length} of {activity.months.length} months precede {SWITCH_MONTH} and are converted from MODIS
            (80% interval {count(low)}–{count(high)} cell-days).
          </p>
        )
        : activity.months.length > 0 && (
          <p className="small kind-line"><Kind kind="measured">measured</Kind> All months observed by VIIRS; no conversion applied.</p>
        )}
      <ActivityChart months={activity.months} />
      <button type="button" className="link" onClick={onMethod}>Method and validation</button>
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

/** Raw detections and FRP: measured, never converted, never compared across 2012. */
function Measured({ stats }: { stats: StatsResponse }) {
  if (stats.detections === 0) {
    return (
      <section className="measured">
        <h3>Detections <Kind kind="measured">raw</Kind></h3>
        <p className="note-box">0 detections in this area and period. The archive covers it; this is an observed zero.</p>
      </section>
    )
  }
  const { this_year: now, typical_year: usual } = stats
  const sensors = [...new Set(stats.by_year.map((y) => y.sensor))]

  return (
    <section className="measured">
      <h3>Detections <Kind kind="measured">raw</Kind></h3>
      <dl className="figures">
        <div><dt>Detections</dt><dd>{count(stats.detections)}</dd></div>
        <div><dt>ΣFRP</dt><dd>{megawatts(stats.sum_frp)}</dd></div>
        <div><dt>Mean FRP</dt><dd>{megawatts(stats.mean_frp)}</dd></div>
        <div>
          <dt>Peak day</dt>
          <dd>{stats.peak_day ? <>{stats.peak_day.date}<span className="sub">{count(stats.peak_day.detections)} detections</span></> : 'n/a'}</dd>
        </div>
      </dl>
      {sensors.length > 1 && <SensorSplit years={stats.by_year} />}
      <p className="small muted">
        {sensors.length > 1 ? 'Pixel detections, uncorrected. MODIS and VIIRS counts are not comparable.' : `Pixel detections from ${sensors[0]}, uncorrected.`}
        {now && usual && usual.detections > 0 && ` ${now.year} to date: ${(now.detections / usual.detections).toFixed(2)}× the median year.`}
      </p>
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

/** How the period's detections divide between the two sensors. */
function SensorSplit({ years }: { years: StatsResponse['by_year'] }) {
  const modis = years.filter((y) => y.sensor === 'MODIS').reduce((sum, y) => sum + y.detections, 0)
  const viirs = years.filter((y) => y.sensor === 'VIIRS').reduce((sum, y) => sum + y.detections, 0)
  const total = Math.max(1, modis + viirs)
  return (
    <div className="split">
      <div className="split-bar" aria-hidden="true">
        <i className="split-modis" style={{ width: `${(modis / total) * 100}%` }} />
        <i className="split-viirs" style={{ width: `${(viirs / total) * 100}%` }} />
      </div>
      <p><span>MODIS {count(modis)}</span><span>VIIRS {count(viirs)}</span></p>
    </div>
  )
}
