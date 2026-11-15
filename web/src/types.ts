// Every response shape the server promises, copied from the frontend handoff.
// If the backend changes a shape, this file is the only place to update.

/**
 * Where the answer came from. Quebec is already loaded; anywhere else in reach is
 * fetched from NASA on demand, and then the first three values are states of that
 * fetch. "outside" means no answer is possible at all.
 */
export type Coverage = 'preloaded' | 'partial' | 'queued' | 'fetching' | 'fetched' | 'outside'

/** True once there are numbers to show, rather than a fetch still running. */
export function hasAnswer(coverage: Coverage): boolean {
  return coverage === 'preloaded' || coverage === 'partial' || coverage === 'fetched'
}

/** The one selection every endpoint except /api/hotspots is asked about. */
export interface Selection {
  lat: number
  lon: number
  /** Only 50, 100 or 200. */
  radius_km: number
  /** First month, inclusive, YYYY-MM. */
  from?: string
  /** Last month, inclusive, YYYY-MM. */
  to?: string
}

/** 422 body. The sentence is already written for users: show it as it is. */
export interface ApiError {
  detail: string
}

// --- GET /api/activity -----------------------------------------------------

export interface ActivityMonth {
  month: string
  /** Map squares that burned, counted once per day. Call it "fire activity". */
  activity: number
  low: number
  high: number
  /** Before February 2012: lifted from the older camera, so an estimate. */
  estimated: boolean
  /** November 2000 to June 2002, when only one satellite was flying. */
  terra_only: boolean
  /** The usual value for that calendar month at this place. */
  median: number
}

export interface ActivitySummary {
  year: number
  months: number[]
  total: number
  median: number
  /** Null when the usual amount is zero. */
  ratio: number | null
  rank: number
  years_compared: number
  /** Already written for users, handles every edge case: show it as it is. */
  sentence: string
}

export interface ActivityResponse {
  coverage: Coverage
  /** 0 to 1 while a place outside Quebec is being fetched. */
  progress: number | null
  curve_source: string | null
  data_through: string | null
  months: ActivityMonth[]
  /** Null when there is too little history to compare. */
  summary: ActivitySummary | null
  /** The server's own sentence when it cannot answer: show it as it is. */
  detail: string | null
}

// --- GET /api/about --------------------------------------------------------

export interface AboutResponse {
  /** The allowed radii, in km. */
  radii_km: number[]
  /** Date of the newest hotspot. */
  data_through: string
  region?: string
  /** The fitted correction. For an explanation panel only. */
  model: Record<string, unknown>
  /** One row per hidden year: how far the correction was out. */
  validation: Record<string, number | string>[]
  /** The same test at circle size. */
  circle_validation: Record<string, number | string>[]
}

// --- GET /api/hotspots?region=quebec --------------------------------------

/** Parallel lists: all five have `count` entries and are sorted by `day`. */
export interface HotspotsResponse {
  region: string
  /** `day` counts whole days from here. */
  epoch: string
  count: number
  data_through: string
  /** west, south, east, north. */
  bbox: [number, number, number, number]
  lon: number[]
  lat: number[]
  day: number[]
  /** Fire radiative power in megawatts. On the page: "fire intensity". */
  frp: number[]
  /** 0 = older camera (MODIS), 1 = newer camera (VIIRS). */
  sensor: number[]
}

/** The same hotspots after conversion to typed arrays for the graphics card. */
export interface HotspotArrays {
  count: number
  epoch: string
  dataThrough: string
  bbox: [number, number, number, number]
  /** lon, lat pairs. */
  positions: Float32Array
  day: Float32Array
  frp: Float32Array
  sensor: Uint8Array
  /** Precomputed, three bytes per hotspot. */
  colors: Uint8Array
  /** Precomputed screen radius in pixels. */
  radius: Float32Array
  minDay: number
  maxDay: number
}

// --- GET /api/stats --------------------------------------------------------

export type SensorName = 'MODIS' | 'VIIRS'

export interface StatsYear {
  year: number
  detections: number
  /** Null in a year with no detections. */
  mean_frp: number | null
  sum_frp: number
  /** Years on either side of 2012 come from different cameras. */
  sensor: SensorName
}

export interface StatsResponse {
  coverage: Coverage
  detail: string | null
  detections: number
  mean_frp: number | null
  sum_frp: number
  peak_day: { date: string; detections: number } | null
  /** Every year in the chosen range, including quiet ones. */
  by_year: StatsYear[]
  /** Median over the other full years measured by the same camera as `this_year`. */
  typical_year: { detections: number; sum_frp: number; years: number } | null
  this_year: { year: number; detections: number; mean_frp: number | null; sum_frp: number } | null
}

// --- GET /api/top-areas ----------------------------------------------------

export interface TopArea {
  /** Centre of a square 0.1 degrees wide, about 10 km. */
  lat: number
  lon: number
  sum_frp: number
  detections: number
  sensor: SensorName
}

export interface TopAreasResponse {
  areas: TopArea[]
}

// --- GET /api/weather ------------------------------------------------------

export interface WeatherDay {
  date: string
  /** Any value can be null when NASA has no reading for that day. */
  precip_mm: number | null
  temp_max_c: number | null
  wind_ms: number | null
  humidity_pct: number | null
}

export interface WeatherResponse {
  source: string
  days: WeatherDay[]
}

// --- GET /api/outlook ------------------------------------------------------

/**
 * How fire-prone the next two weeks usually are at this place, from past seasons and
 * recent weather. Never a forecast of where a fire will spread: say so on the page.
 */
export interface OutlookResponse {
  coverage: Coverage
  detail: string | null
  /** The server's own label for this number. Use it as the heading. */
  label: string
  as_of: string
  window: { from: string; to: string }
  /** Null when there is not enough history to say anything. */
  level: 'low' | 'usual' | 'high' | null
  /** Plain sentences, already written for users. */
  reasons: string[]
  history: {
    years: number
    years_with_fire: number
    median_activity: number
    season_factor: number | null
  } | null
  recent: { activity: number; usual: number } | null
  weather: {
    rain_mm: number
    usual_rain_mm: number
    temp_max_c: number
    usual_temp_max_c: number
  } | null
}
