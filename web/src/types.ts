// Every response shape the server promises, copied from the frontend handoff.
// If the backend changes a shape, this file is the only place to update.

/** Does the selection circle sit inside the data we have? */
export type Coverage = 'canada' | 'partial' | 'outside'

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
  progress: number | null
  curve_source: string
  data_through: string
  months: ActivityMonth[]
  /** Null when there is too little history to compare. */
  summary: ActivitySummary | null
}

// --- GET /api/about --------------------------------------------------------

export interface AboutResponse {
  /** The allowed radii, in km. */
  radii_km: number[]
  /** Date of the newest hotspot. */
  data_through: string
  /** Shapes below are for the explanation panel only and are not fixed yet. */
  model: Record<string, unknown>
  validation: Record<string, unknown>
  circle_validation: Record<string, unknown>
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
  mean_frp: number
  sum_frp: number
  /** Years on either side of 2012 come from different cameras. */
  sensor: SensorName
}

export interface StatsResponse {
  coverage: Coverage
  detections: number
  mean_frp: number
  sum_frp: number
  peak_day: { date: string; detections: number } | null
  by_year: StatsYear[]
  /** Median over years measured by the same camera as `this_year`. */
  typical_year: { detections: number; sum_frp: number } | null
  this_year: { year: number; detections: number; mean_frp: number; sum_frp: number } | null
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

// --- GET /api/outlook (stretch, shape not fixed) ---------------------------

export interface OutlookResponse {
  level: 'low' | 'usual' | 'high'
  reasons: string[]
}
