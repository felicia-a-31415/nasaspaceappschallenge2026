import { AGE_CLASSES, AGE_COLOURS } from '../../lib/situation'
import { cssColour } from '../../map/colourRamp'

/** The map's key in the operational view: a detection's colour is how recent it is. */
export function OpsKey({ squares }: { squares: boolean }) {
  return (
    <div className="legend opskey">
      <p className="legend-title">Detections <span>by age</span></p>
      <ul>
        {AGE_CLASSES.map(({ id, label }, i) => (
          <li key={id}><i style={{ background: cssColour(AGE_COLOURS[i]) }} />{label}</li>
        ))}
        {squares && <li><i className="opskey-cell" />Most active area, numbered</li>}
      </ul>
    </div>
  )
}
