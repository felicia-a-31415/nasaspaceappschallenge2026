// The response arrives as five parallel lists of plain numbers. The graphics card wants
// typed arrays, and the colour and size of every dot never change once loaded, so both
// are worked out here, once, at start-up.

import type { HotspotArrays, HotspotsResponse } from '../types'
import { intensityColour, intensityRadiusPx } from './colourRamp'

export function toHotspotArrays(res: HotspotsResponse): HotspotArrays {
  const count = res.count
  const positions = new Float32Array(count * 2)
  const day = new Float32Array(count)
  const frp = new Float32Array(count)
  const sensor = new Uint8Array(count)
  const colors = new Uint8Array(count * 3)
  const radius = new Float32Array(count)
  let minDay = Infinity
  let maxDay = -Infinity

  for (let i = 0; i < count; i++) {
    positions[i * 2] = res.lon[i]
    positions[i * 2 + 1] = res.lat[i]
    const d = res.day[i]
    day[i] = d
    if (d < minDay) minDay = d
    if (d > maxDay) maxDay = d
    const power = res.frp[i]
    frp[i] = power
    sensor[i] = res.sensor[i]
    const [r, g, b] = intensityColour(power)
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
    radius[i] = intensityRadiusPx(power)
  }

  return {
    count,
    epoch: res.epoch,
    dataThrough: res.data_through,
    bbox: res.bbox,
    positions, day, frp, sensor, colors, radius,
    minDay: count ? minDay : 0,
    maxDay: count ? maxDay : 0,
  }
}
