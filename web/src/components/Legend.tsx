import { formatDate } from '../lib/days'
import { cssColour, intensityFraction, LEGEND_TICKS, rampColour, TOP_INTENSITY_MW } from '../map/colourRamp'

const GRADIENT = Array.from({ length: 11 }, (_, i) => {
  const f = i / 10
  return `${cssColour(rampColour(f))} ${(f * 100).toFixed(0)}%`
}).join(', ')

/** The ramp, its unit in plain words, what the two ends mean, and who the data is from. */
export function Legend({ dataThrough }: { dataThrough?: string }) {
  return (
    <div className="legend panel-surface">
      <h2 className="legend-title">Fire intensity, megawatts</h2>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${GRADIENT})` }} />
      <div className="legend-ticks">
        {LEGEND_TICKS.map((mw) => (
          <span key={mw} style={{ left: `${intensityFraction(mw) * 100}%` }}>
            {mw === TOP_INTENSITY_MW ? `${mw}+` : mw}
          </span>
        ))}
      </div>
      <p className="legend-ends">
        <span>Smouldering</span>
        <span>Fierce</span>
      </p>
      <p className="small muted legend-note">
        Stronger fires are drawn larger as well as lighter. Point at a dot for its date,
        intensity and camera.
      </p>
      <p className="credits">
        {dataThrough ? `Data up to ${formatDate(dataThrough)}. ` : ''}
        Fire data: NASA FIRMS (MODIS, VIIRS).
        <br />Base map © OpenStreetMap contributors, © CARTO.
      </p>
    </div>
  )
}
