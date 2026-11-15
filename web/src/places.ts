// Place search without a Google key (see googlePlaces.ts for the one with). This is a
// service outside our own server:
// Nominatim, OpenStreetMap's free search, which needs no key. Its terms ask for at most
// one request a second and for the credit to be shown, so both are handled here.

import { GOOGLE_PLACES_ENABLED, autocomplete, newSessionToken, placeDetail } from './googlePlaces'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const MIN_GAP_MS = 1000

export const PLACE_SEARCH_CREDIT = GOOGLE_PLACES_ENABLED
  ? 'Place search: Google'
  : 'Place search: OpenStreetMap Nominatim'

export interface Place {
  name: string
  lat: number
  lon: number
}

/** "Chibougamau, Nord-du-Québec, Québec, Canada" reads better as its first two parts. */
export function shortName(displayName: string): string {
  return displayName.split(',').slice(0, 2).map((part) => part.trim()).join(', ')
}

/** One row in the list under the search box while typing. */
export interface Suggestion {
  /** Whatever the provider uses to name this place, such as a place id. */
  id: string
  title: string
  /** A second, quieter line: the region or country. */
  subtitle?: string
}

/**
 * Suggestions for a half-typed place name, from Google Places when a browser key is set
 * (see googlePlaces.ts). Without one the list is empty and the search box offers only
 * "search for what I typed": Nominatim's terms forbid using it for type-ahead.
 *
 * The box waits after the last keystroke and drops stale answers through `signal`.
 * Every autocomplete call and the details call that ends the search share one session
 * token, so Google bills the whole search as one session.
 */
let session: string | null = null

export async function suggestPlaces(query: string, signal?: AbortSignal): Promise<Suggestion[]> {
  if (!GOOGLE_PLACES_ENABLED) return []
  session ??= newSessionToken()
  const found = await autocomplete(query, session, signal)
  return found.map((s) => ({ id: s.placeId, title: s.main, subtitle: s.secondary || undefined }))
}

/** Turn a chosen suggestion into a point on the map. */
export async function resolveSuggestion(suggestion: Suggestion, signal?: AbortSignal): Promise<Place | null> {
  if (!GOOGLE_PLACES_ENABLED) {
    return searchPlace([suggestion.title, suggestion.subtitle].filter(Boolean).join(', '), signal)
  }
  const token = session ?? newSessionToken()
  session = null // the details call closes this billing session
  const place = await placeDetail(suggestion.id, token, signal)
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null
  return { name: place.name || suggestion.title, lat: place.lat, lon: place.lon }
}

let lastCall = 0

/** Null when nothing matched. Throws when the service itself fails. */
export async function searchPlace(query: string, signal?: AbortSignal): Promise<Place | null> {
  if (GOOGLE_PLACES_ENABLED) {
    // Enter without picking: take Google's top suggestion, as Google Maps does.
    const [first] = await suggestPlaces(query, signal)
    return first ? resolveSuggestion(first, signal) : null
  }
  const wait = MIN_GAP_MS - (Date.now() - lastCall)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastCall = Date.now()

  const url = `${ENDPOINT}?${new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'ca',
    limit: '1',
  })}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('The place search did not answer. Try again in a moment.')
  const found = await res.json()
  if (!Array.isArray(found) || found.length === 0) return null
  const [first] = found
  return {
    name: shortName(String(first.display_name ?? query)),
    lat: Number(first.lat),
    lon: Number(first.lon),
  }
}
