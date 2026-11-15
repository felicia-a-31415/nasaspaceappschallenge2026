import { describe, expect, it } from 'vitest'
import { shortName } from './places'

describe('shortName', () => {
  it('keeps the place and its region, not the whole address', () => {
    expect(shortName('Chibougamau, Nord-du-Québec, Québec, Canada')).toBe('Chibougamau, Nord-du-Québec')
    expect(shortName('Val-d’Or')).toBe('Val-d’Or')
  })
})
