// Place search. This is the one service outside our own server the page talks to:
// Nominatim, OpenStreetMap's free search, which needs no key. Its terms ask for at most
// one request a second and for the credit to be shown, so both are handled here.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const MIN_GAP_MS = 1000

export const PLACE_SEARCH_CREDIT = 'Place search: OpenStreetMap Nominatim'

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
 * Suggestions for a half-typed place name. THIS IS THE SEAM FOR GOOGLE PLACES.
 *
 * Nothing is asked today, so the list is empty and the search box offers only "search
 * for what I typed". To add suggestions, return them from here (the box already waits
 * 250 ms after the last keystroke, drops stale answers through `signal`, and handles the
 * list, the keyboard and the screen reader). Nominatim's terms forbid using it for
 * type-ahead, which is why it is not used here.
 */
export async function suggestPlaces(_query: string, _signal?: AbortSignal): Promise<Suggestion[]> {
  return []
}

/**
 * Turn a chosen suggestion into a point on the map. With Google this becomes a place
 * details lookup by `id`; until then the name is simply searched for.
 */
export function resolveSuggestion(suggestion: Suggestion, signal?: AbortSignal): Promise<Place | null> {
  return searchPlace([suggestion.title, suggestion.subtitle].filter(Boolean).join(', '), signal)
}

let lastCall = 0

/** Null when nothing matched. Throws when the service itself fails. */
export async function searchPlace(query: string, signal?: AbortSignal): Promise<Place | null> {
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
