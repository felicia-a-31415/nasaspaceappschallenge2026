import { useEffect, useState } from 'react'
import { ApiRequestError, getHotspots } from '../api'
import { USE_MOCKS } from '../env'
import { toHotspotArrays } from '../map/hotspotArrays'
import { setMockHotspots } from '../mocks/store'
import type { HotspotArrays } from '../types'

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; detail: string }

/** Twenty megabytes: fetched once per page load, never again when the slider moves. */
let request: Promise<HotspotArrays> | null = null

function load(): Promise<HotspotArrays> {
  request ??= getHotspots().then((res) => {
    const arrays = toHotspotArrays(res)
    // The mock endpoints answer from the same hotspots the map is drawing.
    if (USE_MOCKS) setMockHotspots(arrays)
    return arrays
  }).catch((err: unknown) => {
    request = null
    throw err
  })
  return request
}

export function useHotspots(): Loadable<HotspotArrays> {
  const [state, setState] = useState<Loadable<HotspotArrays>>({ status: 'loading' })

  useEffect(() => {
    let live = true
    load()
      .then((data) => { if (live) setState({ status: 'ready', data }) })
      .catch((err: unknown) => {
        if (!live) return
        const detail = err instanceof ApiRequestError
          ? err.detail
          : USE_MOCKS
            ? 'The sample fire data is missing. Run: python3 web/scripts/make-mock-hotspots.py'
            : 'The fire data could not be loaded. Is the server running?'
        setState({ status: 'error', detail })
      })
    return () => { live = false }
  }, [])

  return state
}
