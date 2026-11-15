// Place search without a Google key (see googlePlaces.ts for the one with). This is a
// service outside our own server:
// Nominatim, OpenStreetMap's free search, which needs no key. Its terms ask for at most
// one request a second and for the credit to be shown, so both are handled here.

import { GOOGLE_PLACES_ENABLED, autocomplete, newSessionToken, nearestLocality, placeDetail } from './googlePlaces'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const MIN_GAP_MS = 1000

export const PLACE_SEARCH_CREDIT = GOOGLE_PLACES_ENABLED
  ? 'Place search: Google, OpenStreetMap Nominatim'
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

// --- Naming a point ----------------------------------------------------------------
//
// A clicked point or a ranked cell is named by where it is relative to the nearest town:
// "38 km NW of Chibougamau". With the Google key (itss.earth) that is Nearby Search; it
// finds nothing past 50 km, and without the key (local work) nothing is asked of Google,
// so both fall back to Nominatim's reverse lookup, which names the municipality or region.

const REVERSE = 'https://nominatim.openstreetmap.org/reverse'
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** Great-circle distance in km and the compass point from a to b. */
export function offset(aLat: number, aLon: number, bLat: number, bLon: number): { km: number; toward: string } {
  const rad = Math.PI / 180
  const [p1, p2] = [aLat * rad, bLat * rad]
  const dl = (bLon - aLon) * rad
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  const km = 2 * 6371 * Math.asin(Math.sqrt(h))
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  const bearing = (Math.atan2(y, x) / rad + 360) % 360
  return { km, toward: COMPASS[Math.round(bearing / 45) % 8] }
}

/** "Chibougamau" when within 3 km of it, otherwise "38 km NW of Chibougamau". */
export function relativeTo(town: { name: string; lat: number; lon: number }, lat: number, lon: number): string {
  const { km, toward } = offset(town.lat, town.lon, lat, lon)
  return km < 3 ? town.name : `${Math.round(km)} km ${toward} of ${town.name}`
}

/** Nominatim allows one request a second: every call waits its turn in one queue. */
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastCall = Date.now()
    return task()
  })
  queue = run.catch(() => undefined)
  return run
}

async function reverseRegion(lat: number, lon: number): Promise<string | null> {
  const url = `${REVERSE}?${new URLSearchParams({
    lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '10', 'accept-language': 'en,fr',
  })}`
  const res = await inTurn(() => fetch(url, { headers: { Accept: 'application/json' } }))
  if (!res.ok) return null
  const body = await res.json() as { address?: Record<string, string> }
  const a = body.address ?? {}
  const local = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county
  const region = a.state_district ?? a.region ?? a.state
  const parts = [local, region].filter((part, i, all): part is string => !!part && all.indexOf(part) === i)
  return parts.length ? parts.join(', ') : null
}

const named = new Map<string, Promise<string | null>>()

/**
 * A name a responder can use for a point, or null when none is found. Answers are kept,
 * so the same point (to about 100 m) is only ever asked once.
 */
export function nameNear(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  let answer = named.get(key)
  if (!answer) {
    answer = (async () => {
      if (GOOGLE_PLACES_ENABLED) {
        try {
          const town = await nearestLocality(lat, lon)
          if (town) return relativeTo(town, lat, lon)
        } catch {
          // Fall through to the free lookup.
        }
      }
      return reverseRegion(lat, lon)
    })().catch(() => null)
    named.set(key, answer)
  }
  return answer
}
