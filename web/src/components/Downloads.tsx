import { useState } from 'react'
import { getActivity, hotspotsCsvUrl, monthlyCsvUrl } from '../api'
import { USE_MOCKS } from '../env'
import { monthEndDay, monthStartDay } from '../lib/days'
import { distanceKm } from '../lib/geo'
import { mockHotspots } from '../mocks/store'
import type { Selection } from '../types'

/** The same columns the server writes, so the two files are interchangeable. */
const MONTHLY_COLUMNS = ['month', 'activity', 'low', 'high', 'estimated', 'terra_only', 'median']

function save(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function fileName(what: string, selection: Selection): string {
  return `${what}-${selection.lat.toFixed(2)}_${selection.lon.toFixed(2)}_${selection.radius_km}km.csv`
}

/** With mocks there is no server to write the file, so the page writes the same table. */
async function mockMonthlyCsv(selection: Selection): Promise<string> {
  const answer = await getActivity(selection)
  const rows = answer.months.map((m) => [
    m.month, m.activity, m.low, m.high, m.estimated ? 'True' : 'False',
    m.terra_only ? 'True' : 'False', m.median,
  ].join(','))
  return [MONTHLY_COLUMNS.join(','), ...rows].join('\n') + '\n'
}

async function mockHotspotsCsv(selection: Selection): Promise<string> {
  const h = await mockHotspots()
  const from = selection.from ? monthStartDay(h.epoch, selection.from) : -Infinity
  const to = selection.to ? monthEndDay(h.epoch, selection.to) : Infinity
  const rows: string[] = []
  for (let i = 0; i < h.count; i++) {
    if (h.day[i] < from || h.day[i] > to) continue
    const lon = h.positions[i * 2]
    const lat = h.positions[i * 2 + 1]
    if (distanceKm(selection.lat, selection.lon, lat, lon) > selection.radius_km) continue
    const date = new Date(Date.parse(h.epoch + 'T00:00:00Z') + h.day[i] * 86_400_000)
      .toISOString().slice(0, 10)
    rows.push(`${lat.toFixed(4)},${lon.toFixed(4)},${date},${h.frp[i].toFixed(1)},${h.sensor[i] ? 'VIIRS' : 'MODIS'}`)
  }
  return ['latitude,longitude,acq_date,frp,sensor', ...rows].join('\n') + '\n'
}

export function Downloads({ selection }: { selection: Selection }) {
  const [busy, setBusy] = useState<string | null>(null)

  async function fromMock(what: string, build: () => Promise<string>) {
    setBusy(what)
    try {
      save(fileName(what, selection), await build())
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="downloads" aria-label="Downloads">
      <h3>Take the numbers with you</h3>
      {USE_MOCKS
        ? (
          <div className="download-row">
            <button type="button" disabled={busy !== null} onClick={() => fromMock('fire', () => mockMonthlyCsv(selection))}>
              {busy === 'fire' ? 'Writing…' : 'Monthly table (CSV)'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => fromMock('hotspots', () => mockHotspotsCsv(selection))}>
              {busy === 'hotspots' ? 'Writing…' : 'Every detection (CSV)'}
            </button>
          </div>
        )
        : (
          <div className="download-row">
            <a className="download-link" href={monthlyCsvUrl(selection)} download>Monthly table (CSV)</a>
            <a className="download-link" href={hotspotsCsvUrl(selection)} download>Every detection (CSV)</a>
          </div>
        )}
      <p className="small muted">
        The monthly table holds the same corrected months shown above, with their likely
        range and whether each is measured or estimated. The detections file is the raw
        record, labelled with the camera that saw each one.
      </p>
    </section>
  )
}
