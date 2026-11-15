import { describe, expect, it } from 'vitest'
import { chanceText, forecastDay, fromSpread } from './forecast'
import { DEFAULT_VIEW } from './view'

const shift = { ...DEFAULT_VIEW, lat: 49.05, lon: -76.98, mode: 'shift' as const }

describe('the day a forecast is asked for', () => {
  it('is the as-of day of the operational view, or the end of the record', () => {
    expect(forecastDay({ ...shift, on: '2023-06-03' }, '2026-11-14')).toBe('2023-06-03')
    expect(forecastDay(shift, '2026-11-14')).toBe('2026-11-14')
  })

  it('is never a day the endpoint refuses, and never asked outside the operational view', () => {
    expect(forecastDay({ ...shift, on: '2012-01-19' }, '2026-11-14')).toBeNull()
    expect(forecastDay({ ...shift, on: '2026-11-15' }, '2026-11-14')).toBeNull()
    expect(forecastDay({ ...shift, mode: 'record', on: '2023-06-03' }, '2026-11-14')).toBeNull()
    expect(forecastDay({ ...shift, lat: null, lon: null }, '2026-11-14')).toBeNull()
    expect(forecastDay(shift, undefined)).toBeNull()
  })
})

describe('the server answer as a forecast', () => {
  it('keeps the place and the reasons and drops the squares', () => {
    const place = { lat: 1, lon: 2, nearest_fire_km: 12.4, nearest_fire_from: 'north-west', p: [0.03, 0.08, 0.14], warning_by_day: 3 }
    const body = {
      label: 'Experimental spread forecast', as_of: '2023-06-01', days_ahead: 3, threshold: 0.1, place,
      reasons: ['Wind at the fire that day: 18 km/h from the south-west.'],
      burning: [[1, 2]], cells: [{ lat: 1, lon: 2, new: true, p: [0.1, 0.2, 0.3] }],
    }
    const forecast = fromSpread(body)
    expect(forecast).toMatchObject({ available: true, as_of: '2023-06-01', place, reasons: body.reasons })
    expect(forecast).not.toHaveProperty('cells')
    expect(forecast).not.toHaveProperty('burning')
  })

  it('reads a region with no data yet as no forecast', () => {
    expect(fromSpread({ label: 'Experimental spread forecast', detail: 'Nothing here yet.' }))
      .toEqual({ available: false, reason: 'Nothing here yet.' })
  })

  it('keeps "no fire in the circle" as an answer with no place', () => {
    const forecast = fromSpread({ label: 'x', as_of: '2023-06-01', days_ahead: 3, threshold: 0.1, place: null, reasons: ['No fire was seen.'] })
    expect(forecast).toMatchObject({ available: true, place: null, reasons: ['No fire was seen.'] })
  })
})

describe('a chance in words', () => {
  it('rounds to whole percent and never says 0% for unlikely', () => {
    expect(chanceText(0.284)).toBe('28%')
    expect(chanceText(0.004)).toBe('under 1%')
    expect(chanceText(0)).toBe('under 1%')
  })
})
