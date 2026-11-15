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
