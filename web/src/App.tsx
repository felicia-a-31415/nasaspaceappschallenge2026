import { useEffect, useState } from 'react'
import { getAbout } from './api'
import { Legend } from './components/Legend'
import { TimeBar } from './components/TimeBar'
import { useTimeline } from './hooks/useTimeline'
import { useHotspots } from './hooks/useHotspots'
import { MapView } from './map/MapView'
import type { AboutResponse, Selection } from './types'

export default function App() {
  const hotspots = useHotspots()
  const [about, setAbout] = useState<AboutResponse | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getAbout(controller.signal)
      .then(setAbout)
      .catch(() => setAbout(null))
    return () => controller.abort()
  }, [])

  const data = hotspots.status === 'ready' ? hotspots.data : null
  const timeline = useTimeline(data)
  const dataThrough = about?.data_through ?? data?.dataThrough

  return (
    <div className="app">
      <MapView
        hotspots={data}
        dayRange={timeline.dayRange}
        selection={selection}
        topAreas={[]}
        onMapClick={(lat, lon) => setSelection({ lat, lon, radius_km: selection?.radius_km ?? 100 })}
      />

      <div className="topbar">
        <div className="brand panel-surface">
          <h1>Quebec fire record</h1>
          <p>Every fire detection since 2000, corrected so the two satellite cameras can be compared</p>
        </div>
      </div>

      {data && <Legend dataThrough={dataThrough} />}
      {data && <TimeBar timeline={timeline} epoch={data.epoch} />}

      {hotspots.status === 'loading' && (
        <div className="curtain">
          <div className="curtain-card panel-surface">
            <div className="spinner" />
            <h2>Loading the fire record</h2>
            <p className="muted small">About 723,000 fire detections across Quebec. This happens once.</p>
          </div>
        </div>
      )}

      {hotspots.status === 'error' && (
        <div className="curtain">
          <div className="curtain-card panel-surface" role="alert">
            <h2>The fire data did not load</h2>
            <p className="muted small">{hotspots.detail}</p>
          </div>
        </div>
      )}
    </div>
  )
}
