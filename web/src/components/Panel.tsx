import type { ReactNode } from 'react'
import type { PanelAnswer, PanelState } from '../hooks/usePanel'
import type { QueryState } from '../hooks/useSelectionQuery'
import { formatDate, formatMonth, formatMonthShort, isMonthEnd, periodLabel } from '../lib/days'
import { coordinates, count, megawatts, plural, times } from '../lib/format'
import { hasAnswer } from '../types'
import type {
  ActivityResponse, Coverage, Selection, StatsResponse, TopAreasResponse, WeatherResponse,
} from '../types'
import type { Mode, View } from '../view'
import { Downloads } from './Downloads'
import { ForecastSlot } from './ForecastSlot'
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
  /** The last day the record holds, YYYY-MM-DD. */
  dataThrough?: string
  /** Quick periods for the on-shift view. */
  presets: { label: string; active: boolean; pick: () => void }[]
  onPick: (lat: number, lon: number, name: string | null) => void
  /** False is the small card: the place, the corrected sentence, two figures. */
  expanded: boolean
}

/**
 * The right-hand panel. It is one object: a new place swaps the whole of it once, through
 * a skeleton laid out like the answer, rather than section by section as requests land.
 *
 * It has two arrangements of the same numbers. The record view leads with the corrected
 * sentence. The on-shift view leads with the outlook and the period's intensity, and says
 * first, where it cannot be missed, that this is a record with an end date and not a
 * live feed.
 */
export function Panel(props: PanelProps) {
  const { view, selection, panel, topAreas, onPick, dataThrough, expanded } = props
  const shift = view.mode === 'shift'

  return (
    <>
      {shift && <RecordBanner dataThrough={dataThrough} brief={!expanded} />}
      {shift && expanded && <Presets presets={props.presets} />}

      {!selection && (
        <div className="prompt">
          <h2>Pick a place</h2>
          <p>
            Search for a town, type coordinates, or click anywhere on the map. The numbers
            for the circle you choose appear here.
          </p>
          {!shift && expanded && (
            <p className="muted">
              The map shows every fire detection in Quebec since November 2000. The
              numbers here are corrected so the two satellite cameras can be compared.
              Press play to watch a period fill in, or drag the ends of the time line to
              choose one.
            </p>
          )}
        </div>
      )}

      {selection && !panel.answer && <Skeleton mode={view.mode} brief={!expanded} />}

      {selection && panel.answer && (
        // Keyed by place, so a new place is one entrance, not a patchwork of updates.
        <div
          className={`panel-body ${panel.pending ? 'is-pending' : ''}`}
          key={`${panel.answer.place}|${expanded}`}
          aria-busy={panel.pending}
        >
          <Answer {...props} selection={selection} answer={panel.answer} />
        </div>
      )}

      {expanded && <TopAreas state={topAreas} onPick={onPick} />}
    </>
  )
}

function Answer({ view, selection, placeName, answer, weather, expanded }: PanelProps & {
  selection: Selection
  answer: PanelAnswer
}) {
  const shift = view.mode === 'shift'
  const activity = answer.activity.ok ? answer.activity.data : null
  const stats = answer.stats.ok ? answer.stats.data : null

  const head = (
    <header className="place">
      <p className="eyebrow">Within {selection.radius_km} km of</p>
      <h2>{placeName ?? coordinates(selection.lat, selection.lon)}</h2>
      <p className="muted small">
        {placeName ? `${coordinates(selection.lat, selection.lon)} · ` : ''}
        {periodText(selection)}
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
    <Finding activity={activity} selection={selection} demoted={shift} brief={!expanded} />
  )
  const measured = stats && hasAnswer(stats.coverage) && <Measured stats={stats} shift={shift} brief={!expanded} />
  const outlook = answer.outlook.ok ? <Outlook data={answer.outlook.data} raised={shift} brief={!expanded} /> : null

  // The small card: only what matters most, in the order this view cares about.
  if (!expanded) {
    return shift
      ? <>{head}{problems}{outlook}{measured}{finding}</>
      : <>{head}{problems}{finding}{measured}</>
  }

  if (shift) {
    return (
      <>
        {head}
        {problems}
        {outlook}
        {measured}
        <WeatherStrip state={weather} />
        {finding}
        {stats && hasAnswer(stats.coverage) && stats.detections > 0 && (
          <details className="history">
            <summary>Year by year</summary>
            <YearChart years={stats.by_year} />
          </details>
        )}
        <ForecastSlot view={view} />
        <Downloads selection={selection} />
      </>
    )
  }

  return (
    <>
      {head}
      {problems}
      {finding}
      {measured}
      {stats && hasAnswer(stats.coverage) && stats.detections > 0 && <YearChart years={stats.by_year} />}
      <ForecastSlot view={view} />
      {outlook}
      <WeatherStrip state={weather} />
      <Downloads selection={selection} />
    </>
  )
}

function periodText(selection: Selection): string {
  if (!selection.from || !selection.to) return 'The whole record'
  return selection.from === selection.to
    ? formatMonth(selection.from)
    : `${formatMonthShort(selection.from)} to ${formatMonthShort(selection.to)}`
}

/** Says, before anything else, that this is not a live feed. Plain, not alarming. */
function RecordBanner({ dataThrough, brief }: { dataThrough?: string; brief: boolean }) {
  if (brief) {
    return (
      <div className="record-banner" role="note">
        <strong>A historical record, not a live fire map.</strong>
        {dataThrough && <span>It ends on <b>{formatDate(dataThrough)}</b>.</span>}
      </div>
    )
  }
  return (
    <div className="record-banner" role="note">
      <strong>This is a historical record, not a live fire map.</strong>
      <span>
        {dataThrough
          ? <>It ends on <b>{formatDate(dataThrough)}</b>. Nothing after that date is shown.</>
          : 'It ends on the last day of satellite data loaded. Nothing after that is shown.'}
        {' '}It does not show where a fire is burning now or where one will spread.
      </span>
    </div>
  )
}

function Presets({ presets }: { presets: PanelProps['presets'] }) {
  if (!presets.length) return null
  return (
    <div className="presets">
      <p className="eyebrow">Period, counted back from the end of the record</p>
      <div className="seg" role="group" aria-label="Period">
        {presets.map((p) => (
          <button key={p.label} type="button" aria-pressed={p.active} onClick={p.pick}>{p.label}</button>
        ))}
      </div>
    </div>
  )
}

/** A small label saying what kind of number follows. Words first; the outline is extra. */
function Kind({ kind, children }: { kind: 'measured' | 'estimate' | 'corrected'; children: ReactNode }) {
  return <span className={`kind kind-${kind}`}>{children}</span>
}

/** The corrected sentence: the one thing on this page that compares across 2012. */
function Finding({ activity, selection, demoted, brief }: {
  activity: ActivityResponse
  selection: Selection
  demoted: boolean
  brief: boolean
}) {
  // The record stops part-way through the current month, and a half month is never
  // weighed against whole ones, so the sentence can cover less than the chosen range.
  const unfinished = unfinishedMonth(activity)
  const { summary } = activity
  return (
    <section className={`finding ${demoted ? 'is-demoted' : ''}`} aria-label="Fire activity compared with other years">
      <p className="eyebrow">
        {demoted ? 'Against other years' : 'Fire activity'}
        <Kind kind="corrected">Corrected</Kind>
      </p>
      {summary
        ? (
          <>
            <p className="headline">{summary.sentence}</p>
            {!brief && <p className="small muted">
              Corrected so the two satellite cameras can be compared. This weighs{' '}
              {periodLabel(summary.year, summary.months)} against the same months in{' '}
              {summary.years_compared} other years. Years before 2012 are estimates.
              {unfinished && endsAfter(summary, unfinished)
                ? ` ${formatMonth(unfinished)} is only part way through, so it is left out.`
                : ''}
            </p>}
          </>
        )
        : (
          <p className="headline is-empty">
            {unfinished && selection.from === unfinished
              ? `${formatMonth(unfinished)} is only part way through, so there is nothing `
                + 'to weigh it against yet. Choose an earlier month as well.'
              : 'There is too little history here to say whether this is more fire than usual.'}
          </p>
        )}
      {brief
        ? activity.months.some((m) => m.estimated) && (
          <p className="small kind-line"><Kind kind="estimate">Estimate</Kind> Months before February 2012 are estimates.</p>
        )
        : <EstimatedNote answer={activity} />}
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
        {progress !== null ? `: ${Math.round(progress * 100)}% done` : '…'}. The numbers
        will appear here when it arrives.
      </p>
    )
  }
  if (coverage === 'outside') {
    return <p className="note-box">{detail ?? 'There is no fire history for this place.'}</p>
  }
  return null
}

/** Months before February 2012 are lifted from the older camera, and must say so. */
function EstimatedNote({ answer }: { answer: ActivityResponse }) {
  const estimated = answer.months.filter((m) => m.estimated)
  if (!estimated.length) {
    return answer.months.length
      ? <p className="small kind-line"><Kind kind="measured">Measured</Kind> Every month in this period was seen by the newer camera.</p>
      : null
  }
  const low = estimated.reduce((sum, m) => sum + m.low, 0)
  const high = estimated.reduce((sum, m) => sum + m.high, 0)
  const terra = answer.months.some((m) => m.terra_only)
  return (
    <p className="small kind-line">
      <Kind kind="estimate">Estimate</Kind>{' '}
      {estimated.length === answer.months.length ? 'This period is' : `${estimated.length} of these months are`}
      {' '}before February 2012, so the fire activity is lifted from the older camera:
      likely between {count(low)} and {count(high)}.
      {terra && ' Before July 2002 only one satellite was flying, so even less was seen.'}
    </p>
  )
}

/** Raw detections and intensity: measured, never corrected, never compared across 2012. */
function Measured({ stats, shift, brief }: { stats: StatsResponse; shift: boolean; brief: boolean }) {
  if (stats.detections === 0) {
    return (
      <section className="measured">
        <p className="eyebrow">In this period <Kind kind="measured">Measured</Kind></p>
        <p className="quiet-answer">
          No fire was detected here in this period. That is a real answer, not a gap in the record.
        </p>
      </section>
    )
  }
  const { this_year: now, typical_year: usual } = stats
  const bothCameras = new Set(stats.by_year.map((y) => y.sensor)).size > 1

  const detections = (
    <div key="detections">
      <dt>Fire detections</dt>
      <dd>{count(stats.detections)}</dd>
    </div>
  )
  const average = (
    <div key="average">
      <dt>Average intensity</dt>
      <dd>{megawatts(stats.mean_frp)}</dd>
    </div>
  )
  const total = (
    <div key="total">
      <dt>Total intensity</dt>
      <dd>{megawatts(stats.sum_frp)}</dd>
    </div>
  )
  const busiest = (
    <div key="busiest">
      <dt>Busiest day</dt>
      <dd>
        {stats.peak_day
          ? <>{formatDate(stats.peak_day.date)}<span className="sub">{plural(stats.peak_day.detections, 'detection')}</span></>
          : 'None'}
      </dd>
    </div>
  )

  return (
    <section className={`measured ${shift ? 'is-raised' : ''}`}>
      <p className="eyebrow">
        {shift ? 'In this period' : 'Fire detections'}
        <Kind kind="measured">Measured</Kind>
      </p>
      <dl className="figures">
        {brief
          ? (shift ? [total, busiest] : [detections, busiest])
          : (shift ? [total, busiest, average, detections] : [detections, average, total, busiest])}
      </dl>
      {!brief && <p className="small muted">
        One large fire is thousands of detections, so these count detections, not fires.
        Measured by satellite, not corrected.
        {bothCameras && ' This period spans both satellite cameras, so its count mixes the two and cannot be set beside another period.'}
      </p>}

      {now && !shift && !brief && (
        <p className="this-year">
          <strong>{now.year} so far:</strong> {plural(now.detections, 'detection')}
          {usual
            ? <>, {times(usual.detections ? now.detections / usual.detections : 0)} a typical
              year here ({count(usual.detections)} detections, the middle of {usual.years} years
              seen by the same camera).</>
            : '.'}
        </p>
      )}
    </section>
  )
}

/** Grey blocks where the answer will be, laid out like the answer, so nothing jumps. */
function Skeleton({ mode, brief }: { mode: Mode; brief: boolean }) {
  const place = (
    <div className="sk-group" key="place">
      <i className="sk sk-line" style={{ width: '34%' }} />
      <i className="sk sk-title" style={{ width: '62%' }} />
      <i className="sk sk-line" style={{ width: '48%' }} />
    </div>
  )
  const finding = (
    <div className="sk-group" key="finding">
      <i className="sk sk-line" style={{ width: '40%' }} />
      <i className="sk sk-head" />
      <i className="sk sk-head" style={{ width: '88%' }} />
      <i className="sk sk-head" style={{ width: '54%' }} />
      {!brief && <><i className="sk sk-line" /><i className="sk sk-line" style={{ width: '70%' }} /></>}
    </div>
  )
  const figures = (
    <div className="sk-group" key="figures">
      <i className="sk sk-line" style={{ width: '40%' }} />
      <div className="sk-grid">
        <i className="sk sk-figure" /><i className="sk sk-figure" />
        {!brief && <><i className="sk sk-figure" /><i className="sk sk-figure" /></>}
      </div>
    </div>
  )
  const block = (key: string, height: number) => (
    <i className="sk sk-block" key={key} style={{ height }} />
  )
  return (
    <div className="skeleton" role="status" aria-label="Working out what burned here">
      {brief
        ? (mode === 'shift' ? [place, block('outlook', 56), figures] : [place, finding, figures])
        : mode === 'shift'
        ? [place, block('outlook', 132), figures, block('weather', 150)]
        : [place, finding, figures, block('chart', 118), block('outlook', 132)]}
    </div>
  )
}
