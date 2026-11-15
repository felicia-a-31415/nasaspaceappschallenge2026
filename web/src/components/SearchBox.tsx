import { useEffect, useRef, useState } from 'react'
import { parseCoordinates } from '../lib/geo'
import { coordinates } from '../lib/format'
import { searchPlace } from '../places'
import {
  GOOGLE_PLACES_ENABLED,
  autocomplete,
  newSessionToken,
  placeDetail,
  type Suggestion,
} from '../googlePlaces'

export interface SearchBoxProps {
  radii: number[]
  radiusKm: number
  onRadius: (km: number) => void
  onFound: (lat: number, lon: number, name: string | null) => void
}

/** Waits for a pause in typing before asking for suggestions. */
const DEBOUNCE_MS = 200
const MIN_CHARS = 2

type Option =
  | { kind: 'coords'; lat: number; lon: number }
  | { kind: 'place'; suggestion: Suggestion }

/**
 * A place name ("Chibougamau"), an address, or a coordinate pair ("49.9, -74.4").
 * With a Google key set, suggestions drop down as you type; without one, Enter searches
 * Nominatim as before.
 */
export function SearchBox({ radii, radiusKm, onRadius, onFound }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'idle' | 'searching' | 'none' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  // The text the suggestions were fetched for, so stale ones are never shown or picked.
  const [fetched, setFetched] = useState<{ text: string; list: Suggestion[] }>({ text: '', list: [] })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const request = useRef<AbortController | null>(null)
  const suggestRequest = useRef<AbortController | null>(null)
  const session = useRef<string | null>(null)
  const root = useRef<HTMLDivElement | null>(null)

  const text = query.trim()
  const point = parseCoordinates(text)
  // While typing on from what was fetched ("val" -> "val d"), keep showing the older list
  // until the new one lands, as Google Maps does; anything else hides it.
  const current = fetched.text !== '' && text.toLowerCase().startsWith(fetched.text.toLowerCase())
  const suggestions = current ? fetched.list : []
  const options: Option[] = point
    ? [{ kind: 'coords', lat: point.lat, lon: point.lon }]
    : text.length >= MIN_CHARS
      ? suggestions.map((suggestion) => ({ kind: 'place', suggestion }))
      : []
  const showList = open && options.length > 0

  // Fetch suggestions while typing.
  useEffect(() => {
    if (!GOOGLE_PLACES_ENABLED) return
    const text = query.trim()
    suggestRequest.current?.abort()
    // Too short, or coordinates: the list ignores suggestions then, so leave them be.
    if (text.length < MIN_CHARS || parseCoordinates(text)) return
    const controller = new AbortController()
    suggestRequest.current = controller
    const timer = setTimeout(async () => {
      session.current ??= newSessionToken()
      try {
        const found = await autocomplete(text, session.current, controller.signal)
        if (!controller.signal.aborted) {
          setFetched({ text, list: found })
          setActive(-1)
        }
      } catch {
        // A failed suggestion is not worth a message; Enter still searches.
        if (!controller.signal.aborted) setFetched({ text, list: [] })
      }
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])

  // Close the list on a click anywhere else.
  useEffect(() => {
    function onDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  async function choose(option: Option) {
    setOpen(false)
    setActive(-1)
    if (option.kind === 'coords') {
      setState('idle')
      onFound(option.lat, option.lon, null)
      return
    }
    const { suggestion } = option
    setQuery(suggestion.secondary ? `${suggestion.main}, ${suggestion.secondary}` : suggestion.main)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState('searching')
    try {
      const token = session.current ?? newSessionToken()
      session.current = null // the details call closes this billing session
      const place = await placeDetail(suggestion.placeId, token, controller.signal)
      if (controller.signal.aborted) return
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) throw new Error()
      setState('idle')
      setFetched({ text: '', list: [] })
      onFound(place.lat, place.lon, place.name || suggestion.main)
    } catch (error) {
      if (controller.signal.aborted) return
      setState('failed')
      setMessage(error instanceof Error && error.message ? error.message : 'The place search did not answer.')
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const text = query.trim()
    if (!text) return

    // A highlighted suggestion, or coordinates, need no further lookup.
    if (showList && active >= 0) return choose(options[active])
    if (point) return choose({ kind: 'coords', lat: point.lat, lon: point.lon })

    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setOpen(false)
    setState('searching')
    try {
      if (GOOGLE_PLACES_ENABLED) {
        // Enter without picking: take Google's top suggestion, as Google Maps does.
        session.current ??= newSessionToken()
        // Only the list fetched for exactly this text; otherwise ask for it now.
        const found = fetched.text === text && fetched.list.length > 0
          ? fetched.list
          : await autocomplete(text, session.current, controller.signal)
        if (controller.signal.aborted) return
        if (found.length > 0) return choose({ kind: 'place', suggestion: found[0] })
      } else {
        const place = await searchPlace(text, controller.signal)
        if (controller.signal.aborted) return
        if (place) {
          setState('idle')
          onFound(place.lat, place.lon, place.name)
          return
        }
      }
      setState('none')
      setMessage(`No place found for “${text}”. Try a town name, or coordinates like 49.9, -74.4.`)
    } catch (error) {
      if (controller.signal.aborted) return
      setState('failed')
      setMessage(error instanceof Error ? error.message : 'The place search did not answer.')
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (options.length === 0) return
    event.preventDefault()
    setOpen(true)
    const step = event.key === 'ArrowDown' ? 1 : -1
    // -1 is the text as typed; wrap through it like Google Maps does.
    setActive((i) => ((i + 1 + step + options.length + 1) % (options.length + 1)) - 1)
  }

  const listId = 'place-suggestions'
  const optionId = (i: number) => `place-suggestion-${i}`

  return (
    <div className="search panel-surface" ref={root}>
      <form onSubmit={submit} role="search">
        <label className="visually-hidden" htmlFor="place">Place name, address or coordinates</label>
        <div className="search-field">
          <input
            id="place"
            type="text"
            value={query}
            placeholder="Chibougamau, or 49.9, -74.4"
            autoComplete="off"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            onChange={(e) => { setQuery(e.target.value); setState('idle'); setOpen(true); setActive(-1) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {showList && (
            <ul className="suggestions" id={listId} role="listbox" aria-label="Suggestions">
              {options.map((option, i) => (
                <li
                  key={option.kind === 'coords' ? 'coords' : option.suggestion.placeId}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'active' : undefined}
                  // pointerdown, not click, so the input does not lose focus first
                  onPointerDown={(e) => { e.preventDefault(); void choose(option) }}
                  onPointerEnter={() => setActive(i)}
                >
                  {option.kind === 'coords'
                    ? (
                      <>
                        <span className="suggestion-main">{coordinates(option.lat, option.lon)}</span>
                        <span className="suggestion-secondary">Go to these coordinates</span>
                      </>
                    )
                    : (
                      <>
                        <span className="suggestion-main">{option.suggestion.main}</span>
                        {option.suggestion.secondary && (
                          <span className="suggestion-secondary">{option.suggestion.secondary}</span>
                        )}
                      </>
                    )}
                </li>
              ))}
              {options[0]?.kind === 'place' && (
                <li className="suggestions-credit" role="presentation" aria-hidden="true">
                  Powered by Google
                </li>
              )}
            </ul>
          )}
        </div>
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
