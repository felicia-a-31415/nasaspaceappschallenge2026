// The mock endpoints answer from the hotspots the page has already loaded, so the
// numbers in the panel always agree with the dots on the map. The app hands the
// loaded arrays over once; anything asked before that waits.

import type { HotspotArrays } from '../types'

let loaded: HotspotArrays | null = null
let waiting: ((h: HotspotArrays) => void)[] = []

export function setMockHotspots(h: HotspotArrays): void {
  loaded = h
  const pending = waiting
  waiting = []
  for (const resolve of pending) resolve(h)
}

export function mockHotspots(): Promise<HotspotArrays> {
  if (loaded) return Promise.resolve(loaded)
  return new Promise((resolve) => waiting.push(resolve))
}
