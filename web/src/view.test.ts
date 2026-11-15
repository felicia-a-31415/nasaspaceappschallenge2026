import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, isDefaultView, parseView, serializeView } from './view'

describe('the view in the address', () => {
  it('comes back the same after a round trip', () => {
    const view = { lat: 49.9, lon: -74.4, radius_km: 200, from: '2023-05', to: '2023-09', mode: 'shift' as const }
    expect(parseView(serializeView(view))).toEqual(view)
    expect(parseView('?' + serializeView(view))).toEqual(view)
  })

  it('leaves the defaults out, so a plain address stays plain', () => {
    expect(serializeView(DEFAULT_VIEW)).toBe('')
    expect(parseView('')).toEqual(DEFAULT_VIEW)
    expect(isDefaultView(parseView('?utm=x'))).toBe(true)
  })

  it('falls back rather than trusting a damaged link', () => {
    const view = parseView('?lat=abc&lon=-74&radius_km=75&from=2023-13&to=nonsense&mode=live')
    expect(view).toEqual(DEFAULT_VIEW)
    expect(parseView('?lat=95&lon=-74').lat).toBeNull()
    expect(parseView('?lat=49.9').lon).toBeNull()
  })

  it('puts a back-to-front period the right way round', () => {
    const view = parseView('?from=2023-09&to=2023-05')
    expect([view.from, view.to]).toEqual(['2023-05', '2023-09'])
  })

  it('keeps coordinates to four decimal places', () => {
    expect(serializeView({ ...DEFAULT_VIEW, lat: 49.900049, lon: -74.4 })).toBe('lat=49.9&lon=-74.4')
  })
})
