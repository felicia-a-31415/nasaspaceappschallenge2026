import { useRef, useState } from 'react'
import { parseCoordinates } from '../lib/geo'
import { searchPlace } from '../places'

export interface SearchBoxProps {
  radii: number[]
  radiusKm: number
  onRadius: (km: number) => void
  onFound: (lat: number, lon: number, name: string | null) => void
}

/** A place name ("Chibougamau") or a coordinate pair ("49.9, -74.4" or "49.9 -74.4"). */
export function SearchBox({ radii, radiusKm, onRadius, onFound }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'idle' | 'searching' | 'none' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const text = query.trim()
    if (!text) return

    // Coordinates first: they need no service at all.
    const point = parseCoordinates(text)
    if (point) {
      setState('idle')
      onFound(point.lat, point.lon, null)
      return
    }

    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState('searching')
    try {
      const place = await searchPlace(text, controller.signal)
      if (controller.signal.aborted) return
      if (!place) {
        setState('none')
        setMessage(`No place found for “${text}”. Try a town name, or coordinates like 49.9, -74.4.`)
        return
      }
      setState('idle')
      onFound(place.lat, place.lon, place.name)
    } catch (error) {
      if (controller.signal.aborted) return
      setState('failed')
      setMessage(error instanceof Error ? error.message : 'The place search did not answer.')
    }
  }

  return (
    <div className="search panel-surface">
      <form onSubmit={submit} role="search">
        <label className="visually-hidden" htmlFor="place">Place name or coordinates</label>
        <input
          id="place"
          type="text"
          value={query}
          placeholder="Chibougamau, or 49.9, -74.4"
          autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setState('idle') }}
        />
        <button type="submit" disabled={state === 'searching'}>
          {state === 'searching' ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div className="radii" role="group" aria-label="Size of the circle">
        {radii.map((km) => (
          <button key={km} type="button" aria-pressed={km === radiusKm} onClick={() => onRadius(km)}>
            {km} km
          </button>
        ))}
      </div>

      {(state === 'none' || state === 'failed') && (
        <p className="small search-message" role="status">{message}</p>
      )}
      <p className="small muted search-hint">Or click anywhere on the map.</p>
    </div>
  )
}
