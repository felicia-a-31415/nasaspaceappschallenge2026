import { useEffect, useId, useRef, useState } from 'react'
import { parseCoordinates } from '../lib/geo'
import { coordinates } from '../lib/format'
import { resolveSuggestion, searchPlace, suggestPlaces } from '../places'
import type { Place, Suggestion } from '../places'

export interface SearchBoxProps {
  onFound: (lat: number, lon: number, name: string | null) => void
}

/** How long typing must pause before suggestions are asked for. */
const SUGGEST_AFTER_MS = 250

type Row =
  | { kind: 'coordinates'; lat: number; lon: number }
  | { kind: 'suggestion'; suggestion: Suggestion }
  | { kind: 'search'; text: string }

/**
 * The search box: a place name ("Chibougamau") or a coordinate pair ("49.9, -74.4").
 *
 * While typing, a list opens underneath. It holds whatever `suggestPlaces` returns, which
 * is nothing until a suggestion service is plugged in there, and always ends with a row
 * that searches for the text as typed. Arrow keys move through it, Enter chooses, Escape
 * closes.
 */
export function SearchBox({ onFound }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const [state, setState] = useState<'idle' | 'searching' | 'none' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()

  const text = query.trim()

  // Ask for suggestions once typing pauses. A stale answer is dropped.
  useEffect(() => {
    if (!text || parseCoordinates(text)) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      suggestPlaces(text, controller.signal)
        .then((found) => { if (!controller.signal.aborted) setSuggestions(found) })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]) })
    }, SUGGEST_AFTER_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [text])

  // Click away to close the list.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const point = text ? parseCoordinates(text) : null
  const rows: Row[] = !text
    ? []
    : point
      ? [{ kind: 'coordinates', ...point }]
      : [...suggestions.map((suggestion): Row => ({ kind: 'suggestion', suggestion })), { kind: 'search', text }]
  const current = Math.min(active, Math.max(0, rows.length - 1))
  const showList = open && rows.length > 0

  async function lookUp(label: string, find: (signal: AbortSignal) => Promise<Place | null>) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState('searching')
    try {
      const place = await find(controller.signal)
      if (controller.signal.aborted) return
      if (!place) {
        setState('none')
        setMessage(`No place found for “${label}”. Try a town name, or coordinates like 49.9, -74.4.`)
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

  function choose(row: Row) {
    setOpen(false)
    if (row.kind === 'coordinates') {
      setState('idle')
      onFound(row.lat, row.lon, null)
    } else if (row.kind === 'suggestion') {
      setQuery(row.suggestion.title)
      void lookUp(row.suggestion.title, (signal) => resolveSuggestion(row.suggestion, signal))
    } else {
      void lookUp(row.text, (signal) => searchPlace(row.text, signal))
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (rows.length) choose(rows[current])
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!rows.length) return
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + rows.length) % rows.length)
    }
  }

  return (
    <div className={`searchbox ${showList ? 'is-open' : ''}`} ref={box}>
      <form onSubmit={submit} role="search">
                <label className="visually-hidden" htmlFor="place">Place name or coordinates</label>
        <input
          id="place"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${current}` : undefined}
          value={query}
          placeholder="Place, or lat, lon"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setQuery(e.target.value); setState('idle'); setActive(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="search-go" disabled={state === 'searching'} aria-label="Search">
          {state === 'searching'
            ? <span className="search-busy" aria-hidden="true" />
            : (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12.8 12.8 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
        </button>
      </form>

      {showList && (
        <ul className="suggest" id={listId} role="listbox" aria-label="Places">
          {rows.map((row, index) => (
            <li
              key={row.kind === 'suggestion' ? `s-${row.suggestion.id}` : row.kind}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              onPointerEnter={() => setActive(index)}
              // Before the input loses focus, so the choice is not lost to the blur.
              onPointerDown={(event) => { event.preventDefault(); choose(row) }}
            >
              <RowIcon kind={row.kind} />
              {row.kind === 'coordinates' && (
                <span><b>{coordinates(row.lat, row.lon)}</b><small>Go to these coordinates</small></span>
              )}
              {row.kind === 'suggestion' && (
                <span><b>{row.suggestion.title}</b>{row.suggestion.subtitle && <small>{row.suggestion.subtitle}</small>}</span>
              )}
              {row.kind === 'search' && (
                <span><b>{row.text}</b><small>Search for this place</small></span>
              )}
            </li>
          ))}
        </ul>
      )}

      {(state === 'none' || state === 'failed') && !showList && (
        <p className="small search-message" role="status">{message}</p>
      )}
    </div>
  )
}

function RowIcon({ kind }: { kind: Row['kind'] }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      {kind === 'search'
        ? (
          <>
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12.8 12.8 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </>
        )
        : (
          <>
            <path d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0C4.500 12.800 10 18 10 18Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="10" cy="8.500" r="1.900" fill="currentColor" />
          </>
        )}
    </svg>
  )
}
