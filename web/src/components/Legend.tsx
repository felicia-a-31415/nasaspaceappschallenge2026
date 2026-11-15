import { cssColour, intensityFraction, intensityRadiusPx, LEGEND_TICKS, rampColour, TOP_INTENSITY_MW } from '../map/colourRamp'

const GRADIENT = Array.from({ length: 11 }, (_, i) => {
  const f = i / 10
  return `${cssColour(rampColour(f))} ${(f * 100).toFixed(0)}%`
}).join(', ')

export interface LegendProps {
  /** Whether intensity is drawn as a glow when zoomed out. */
  field: boolean
  onField: (on: boolean) => void
}

/**
 * What the colours mean, in plain words. Intensity is carried twice, by lightness and by
 * size, and the sample dots show both, so colour is never the only signal.
 */
export function Legend({ field, onField }: LegendProps) {
  return (
    <div className="legend">
      <p className="eyebrow">Fire intensity <span className="unit">megawatts per detection</span></p>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${GRADIENT})` }} />
      <div className="legend-ticks">
        {LEGEND_TICKS.map((mw) => (
          <span key={mw} style={{ left: `${intensityFraction(mw) * 100}%` }}>
            <i
              aria-hidden="true"
              style={{
                width: intensityRadiusPx(mw) * 2,
                height: intensityRadiusPx(mw) * 2,
                background: cssColour(rampColour(intensityFraction(mw))),
              }}
            />
            {mw === TOP_INTENSITY_MW ? `${mw}+` : mw}
          </span>
        ))}
      </div>
      <p className="legend-ends"><span>Smouldering, small</span><span>Fierce, large</span></p>
      <label
        className="switch"
        title="Zoomed out, adds up fire intensity over the chosen period. It is not a count of detections. Rests while playing."
      >
        <input type="checkbox" checked={field} onChange={(e) => onField(e.target.checked)} />
        <span>Glow when zoomed out</span>
      </label>
    </div>
  )
}
