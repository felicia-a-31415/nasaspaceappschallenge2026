import { useState } from 'react'
import { getActivity, hotspotsCsvUrl, monthlyCsvUrl } from '../api'
import { USE_MOCKS } from '../env'
import { dayToDate, monthEndDay, monthStartDay } from '../lib/days'
import { distanceKm } from '../lib/geo'
import { BASE_CREDIT } from '../map/baseMap'
import { sliceByDay } from '../map/field'
import type { HotspotArrays, Selection } from '../types'

/** The same columns the server writes, so the two files are interchangeable. */
const MONTHLY_COLUMNS = ['month', 'activity', 'low', 'high', 'estimated', 'terra_only', 'median']

function save(name: string, content: Blob) {
  const url = URL.createObjectURL(content)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function fileName(what: string, selection: Selection, extension: string): string {
  const period = selection.from && selection.to ? `_${selection.from}_${selection.to}` : ''
  return `${what}_${selection.lat.toFixed(2)}_${selection.lon.toFixed(2)}_${selection.radius_km}km${period}.${extension}`
}

/** Indices of the detections inside the area and period. */
function inside(h: HotspotArrays, selection: Selection): number[] {
  const from = selection.from ? monthStartDay(h.epoch, selection.from) : h.minDay
  const to = selection.to ? monthEndDay(h.epoch, selection.to) : h.maxDay
  const slice = sliceByDay(h.day, from, to) ?? [0, h.count]
  const found: number[] = []
  for (let i = slice[0]; i < slice[1]; i++) {
    if (h.day[i] < from || h.day[i] > to) continue
    if (distanceKm(selection.lat, selection.lon, h.positions[i * 2 + 1], h.positions[i * 2]) <= selection.radius_km) found.push(i)
  }
  return found
}

/** RFC 7946 points, one per detection, with the fields FIRMS publishes. */
function geoJson(h: HotspotArrays, selection: Selection): string {
  const features = inside(h, selection).map((i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(h.positions[i * 2].toFixed(5)), Number(h.positions[i * 2 + 1].toFixed(5))] },
    properties: {
      acq_date: dayToDate(h.epoch, h.day[i]),
      frp_mw: Number(h.frp[i].toFixed(1)),
      sensor: h.sensor[i] ? 'VIIRS' : 'MODIS',
    },
  }))
  return JSON.stringify({
    type: 'FeatureCollection',
    name: 'firms_detections',
    source: 'NASA FIRMS: MODIS C6.1, VIIRS C2',
    aoi: { lat: selection.lat, lon: selection.lon, radius_km: selection.radius_km, from: selection.from ?? null, to: selection.to ?? null },
    features,
  })
}

function hotspotsCsv(h: HotspotArrays, selection: Selection): string {
  const rows = inside(h, selection).map((i) => (
    `${h.positions[i * 2 + 1].toFixed(4)},${h.positions[i * 2].toFixed(4)},${dayToDate(h.epoch, h.day[i])},${h.frp[i].toFixed(1)},${h.sensor[i] ? 'VIIRS' : 'MODIS'}`
  ))
  return ['latitude,longitude,acq_date,frp,sensor', ...rows].join('\n') + '\n'
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

/** The map as drawn, with a caption strip naming the area, period and sources. */
function mapImage(canvas: HTMLCanvasElement, selection: Selection): Promise<Blob | null> {
  const strip = Math.round(canvas.height * 0.045)
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height + strip
  const ctx = out.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(canvas, 0, 0)
  ctx.fillStyle = '#07090b'
  ctx.fillRect(0, canvas.height, out.width, strip)
  ctx.fillStyle = '#b6b3ac'
  ctx.font = `${Math.round(strip * 0.4)}px "IBM Plex Mono", monospace`
  ctx.textBaseline = 'middle'
  const period = selection.from && selection.to ? `${selection.from} → ${selection.to}` : 'full record'
  ctx.fillText(
    `AOI ${selection.lat.toFixed(4)}, ${selection.lon.toFixed(4)} · R ${selection.radius_km} km · ${period} · NASA FIRMS (MODIS C6.1, VIIRS C2) · ${BASE_CREDIT}`,
    strip * 0.4, canvas.height + strip / 2, out.width - strip * 0.8,
  )
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'))
}

export function Downloads({ selection, hotspots, getCanvas }: {
  selection: Selection
  hotspots: HotspotArrays | null
  getCanvas: () => HTMLCanvasElement | null
}) {
  const [busy, setBusy] = useState<string | null>(null)

  async function write(what: string, extension: string, build: () => Promise<Blob | null> | Blob | null) {
    setBusy(what)
    try {
      const content = await build()
      if (content) save(fileName(what, selection, extension), content)
    } finally {
      setBusy(null)
    }
  }
  const text = (type: string, body: string) => new Blob([body], { type })
  const canvas = getCanvas()

  return (
    <section className="downloads" aria-label="Export">
      <h3>Export</h3>
      <div className="export-row">
        {USE_MOCKS
          ? <button type="button" disabled={busy !== null} onClick={() => write('activity_monthly', 'csv', async () => text('text/csv', await mockMonthlyCsv(selection)))}>Monthly CSV</button>
          : <a className="download-link" href={monthlyCsvUrl(selection)} download>Monthly CSV</a>}
        {USE_MOCKS
          ? <button type="button" disabled={busy !== null || !hotspots} onClick={() => write('detections', 'csv', () => hotspots && text('text/csv', hotspotsCsv(hotspots, selection)))}>Detections CSV</button>
          : <a className="download-link" href={hotspotsCsvUrl(selection)} download>Detections CSV</a>}
        <button
          type="button" disabled={busy !== null || !hotspots}
          onClick={() => write('detections', 'geojson', () => hotspots && text('application/geo+json', geoJson(hotspots, selection)))}
        >
          GeoJSON
        </button>
        <button type="button" disabled={busy !== null || !canvas} onClick={() => write('map', 'png', () => canvas && mapImage(canvas, selection))}>Map image</button>
      </div>
    </section>
  )
}
