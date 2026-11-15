import { describe, expect, it } from 'vitest'
import {
  dateToDay, dayToDate, dayToMonth, formatDate, formatMonth, monthEndDay, monthRange, monthStartDay,
} from './days'

const EPOCH = '2000-01-01'

describe('days', () => {
  it('matches the two anchors the backend gave us', () => {
    // "Day 311 is 7 November 2000; the newest is day 9813."
    expect(dayToDate(EPOCH, 311)).toBe('2000-11-07')
    expect(dateToDay(EPOCH, '2000-11-07')).toBe(311)
    expect(dayToDate(EPOCH, 9813)).toBe('2026-11-13')
  })

  it('is unaffected by the local time zone', () => {
    expect(dateToDay(EPOCH, '2000-01-01')).toBe(0)
    expect(dayToMonth(EPOCH, 9813)).toBe('2026-11')
  })

  it('walks months across year ends', () => {
    expect(monthRange('2011-11', '2012-02')).toEqual(['2011-11', '2011-12', '2012-01', '2012-02'])
    expect(monthRange('2023-06', '2023-06')).toEqual(['2023-06'])
  })

  it('bounds a month in days, leap years included', () => {
    expect(dayToDate(EPOCH, monthStartDay(EPOCH, '2023-06'))).toBe('2023-06-01')
    expect(dayToDate(EPOCH, monthEndDay(EPOCH, '2023-06'))).toBe('2023-06-30')
    expect(dayToDate(EPOCH, monthEndDay(EPOCH, '2024-02'))).toBe('2024-02-29')
    expect(dayToDate(EPOCH, monthEndDay(EPOCH, '2023-12'))).toBe('2023-12-31')
  })

  it('writes dates the way the page reads them', () => {
    expect(formatMonth('2023-06')).toBe('June 2023')
    expect(formatDate('2026-11-13')).toBe('13 November 2026')
  })
})
