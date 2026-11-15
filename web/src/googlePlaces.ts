// Suggestions as you type, from the Google Places API (New), called over plain HTTPS so
// the Maps JavaScript library never has to load. Only used when a browser key is set:
//
//     VITE_GOOGLE_MAPS_API_KEY=... npm run dev
//
// The key is visible to everyone who opens the page, so restrict it in the Google Cloud
// console to this site's address and to the Places API (New) alone.
//
// Billing: every keystroke's autocomplete call plus the one details call at the end share
// a session token, so Google bills the whole search as one session.

const KEY: string = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const BASE = 'https://places.googleapis.com/v1'

export const GOOGLE_PLACES_ENABLED = KEY !== ''

/** Quebec, give or take, so local places rank above namesakes elsewhere. */
const QUEBEC = {
  rectangle: {
    low: { latitude: 44.9, longitude: -79.8 },
    high: { latitude: 62.6, longitude: -57.1 },
  },
}

export interface Suggestion {
  placeId: string
  /** "Chibougamau" */
  main: string
  /** "QC, Canada" */
  secondary: string
}

export interface PlaceDetail {
  name: string
  lat: number
  lon: number
}

export function newSessionToken(): string {
  return crypto.randomUUID()
}

/** Shapes the API's answer into suggestions, dropping query predictions (not places). */
export function toSuggestions(body: unknown): Suggestion[] {
  const list = (body as { suggestions?: unknown[] } | null)?.suggestions
  if (!Array.isArray(list)) return []
  const out: Suggestion[] = []
  for (const item of list) {
    const p = (item as { placePrediction?: Record<string, unknown> }).placePrediction
    if (!p || typeof p.placeId !== 'string') continue
    const fmt = p.structuredFormat as
      | { mainText?: { text?: string }; secondaryText?: { text?: string } }
      | undefined
    const whole = (p.text as { text?: string } | undefined)?.text ?? ''
    out.push({
      placeId: p.placeId,
      main: fmt?.mainText?.text ?? whole,
      secondary: fmt?.secondaryText?.text ?? '',
    })
  }
  return out
}

export async function autocomplete(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const res = await fetch(`${BASE}/places:autocomplete`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY },
    body: JSON.stringify({
      input,
      sessionToken,
      locationBias: QUEBEC,
      includedRegionCodes: ['ca'],
    }),
  })
  if (!res.ok) throw new Error('The place search did not answer. Try again in a moment.')
  return toSuggestions(await res.json())
}

/** Where a picked suggestion is. Ends the billing session. */
export async function placeDetail(
  placeId: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceDetail> {
  const url = `${BASE}/places/${encodeURIComponent(placeId)}?${new URLSearchParams({ sessionToken })}`
  const res = await fetch(url, {
    signal,
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'displayName,shortFormattedAddress,location' },
  })
  if (!res.ok) throw new Error('The place search did not answer. Try again in a moment.')
  const body = await res.json()
  return {
    name: body.displayName?.text ?? body.shortFormattedAddress ?? '',
    lat: Number(body.location?.latitude),
    lon: Number(body.location?.longitude),
  }
}

export interface NearbyPlace {
  name: string
  lat: number
  lon: number
}

/**
 * The nearest town or city within `radiusM` (Google caps it at 50 km), or null. Uses
 * Nearby Search from the same Places API (New), so the key needs nothing more.
 */
export async function nearestLocality(
  lat: number,
  lon: number,
  radiusM = 50000,
  signal?: AbortSignal,
): Promise<NearbyPlace | null> {
  const res = await fetch(`${BASE}/places:searchNearby`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.displayName,places.location',
    },
    body: JSON.stringify({
      includedTypes: ['locality'],
      maxResultCount: 1,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: radiusM } },
    }),
  })
  if (!res.ok) throw new Error('Nearby search failed')
  const body = await res.json() as { places?: { displayName?: { text?: string }; location?: { latitude?: number; longitude?: number } }[] }
  const first = body.places?.[0]
  const name = first?.displayName?.text
  const pLat = Number(first?.location?.latitude)
  const pLon = Number(first?.location?.longitude)
  return name && Number.isFinite(pLat) && Number.isFinite(pLon) ? { name, lat: pLat, lon: pLon } : null
}
