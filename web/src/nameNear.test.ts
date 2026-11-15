import { describe, expect, it } from 'vitest'
import { offset, relativeTo } from './places'

const chibougamau = { name: 'Chibougamau', lat: 49.913, lon: -74.379 }

describe('relativeTo', () => {
  it('uses the town name when the point is in it', () => {
    expect(relativeTo(chibougamau, 49.92, -74.37)).toBe('Chibougamau')
  })
  it('gives distance and direction from the town', () => {
    // About 0.3 degrees north is about 33 km.
    expect(relativeTo(chibougamau, 50.213, -74.379)).toBe('33 km N of Chibougamau')
  })
  it('points the compass from the town to the point', () => {
    expect(offset(0, 0, -1, -1).toward).toBe('SW')
    expect(offset(0, 0, 0, 1).toward).toBe('E')
  })
})
