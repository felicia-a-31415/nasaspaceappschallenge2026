import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, getForecast } from '../api'
import type { Forecast } from '../forecast'
import { DEFAULT_VIEW } from '../view'
import { ForecastSlot } from './ForecastSlot'

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), getForecast: vi.fn() }))
const asked = vi.mocked(getForecast)

const view = { ...DEFAULT_VIEW, lat: 49.05, lon: -76.98, radius_km: 50, mode: 'shift' as const, on: '2023-06-03' }
const answer: Forecast = {
  available: true, label: 'Experimental spread forecast', as_of: '2023-06-03', days_ahead: 3, threshold: 0.1,
  place: { nearest_fire_km: 12.4, nearest_fire_from: 'north-west', p: [0.03, 0.08, 0.14], warning_by_day: 3 },
  reasons: ['Wind at the fire that day: 18 km/h from the south-west.'],
}

afterEach(() => { cleanup(); asked.mockReset() })

describe('the spread forecast in the panel', () => {
  it('gives the chance for the point by day, the nearest fire, the reasons and the limits', async () => {
    asked.mockResolvedValue(answer)
    const { container } = render(<ForecastSlot view={view} dataThrough="2026-11-14" />)
    await screen.findByText('Experimental spread forecast')
    expect(asked).toHaveBeenCalledWith(view, '2023-06-03', expect.anything())
    const text = container.textContent ?? ''
    expect(text).toContain('Chance of fire within 2 km of this point, from 3 June 2023')
    expect(text).toContain('Within 1 dayby 4 June3%')
    expect(text).toContain('Within 3 daysby 6 June14%')
    expect(text).toContain('Warning level (1 in 10 or more) reached within 3 days.')
    expect(text).toContain('Nearest fire that day: 12 km to the north-west.')
    expect(text).toContain('18 km/h from the south-west')
    expect(text).toContain('Experimental')
    expect(text).toContain('Satellites miss fire under thick smoke.')
  })

  it('shows only the reason when no fire was in the circle', async () => {
    asked.mockResolvedValue({ ...answer, place: null, reasons: ['No fire was seen inside this circle on that day, so there is nothing to spread.'] })
    const { container } = render(<ForecastSlot view={view} dataThrough="2026-11-14" />)
    await screen.findByText(/nothing to spread/)
    expect(container.textContent).not.toContain('Chance of fire')
  })

  it('asks nothing for a day the endpoint refuses, or outside the operational view', () => {
    const early = render(<ForecastSlot view={{ ...view, on: '2011-07-01' }} dataThrough="2026-11-14" />)
    const late = render(<ForecastSlot view={{ ...view, on: '2026-12-01' }} dataThrough="2026-11-14" />)
    const record = render(<ForecastSlot view={{ ...view, mode: 'record' }} dataThrough="2026-11-14" />)
    expect(asked).not.toHaveBeenCalled()
    for (const made of [early, late, record]) expect(made.container.innerHTML).toBe('')
  })

  it('draws nothing when the server refuses or has no forecast', async () => {
    asked.mockRejectedValue(new ApiRequestError('The forecast can only start from a day up to 2026-11-14.', 422))
    const refused = render(<ForecastSlot view={view} dataThrough="2026-11-14" />)
    await waitFor(() => expect(refused.container.innerHTML).toBe(''))
    asked.mockResolvedValue({ available: false, reason: 'Nothing here yet.' })
    const none = render(<ForecastSlot view={{ ...view, lat: 60 }} dataThrough="2026-11-14" />)
    await waitFor(() => expect(none.container.innerHTML).toBe(''))
  })
})
