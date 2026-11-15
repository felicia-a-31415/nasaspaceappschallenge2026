import { describe, expect, it } from 'vitest'
import { toSuggestions } from './googlePlaces'

describe('toSuggestions', () => {
  it('keeps place predictions and splits them into main and secondary text', () => {
    const body = {
      suggestions: [
        {
          placePrediction: {
            placeId: 'abc',
            text: { text: 'Chibougamau, QC, Canada' },
            structuredFormat: { mainText: { text: 'Chibougamau' }, secondaryText: { text: 'QC, Canada' } },
          },
        },
        { queryPrediction: { text: { text: 'chibougamau hotels' } } },
        { placePrediction: { placeId: 'def', text: { text: 'Val-d’Or' } } },
      ],
    }
    expect(toSuggestions(body)).toEqual([
      { placeId: 'abc', main: 'Chibougamau', secondary: 'QC, Canada' },
      { placeId: 'def', main: 'Val-d’Or', secondary: '' },
    ])
  })

  it('is empty for an empty or odd answer', () => {
    expect(toSuggestions({})).toEqual([])
    expect(toSuggestions(null)).toEqual([])
  })
})
