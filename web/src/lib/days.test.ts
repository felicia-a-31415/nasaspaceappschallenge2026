import { describe, expect, it } from 'vitest'
import {
  dateToDay, dayToDate, dayToMonth, formatDate, formatMonth, isMonthEnd, monthEndDay, monthRange,
  monthStartDay, periodLabel, previousMonth,
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

  it('knows when a month has run out', () => {
    expect(isMonthEnd('2026-11-14')).toBe(false)
    expect(isMonthEnd('2026-11-30')).toBe(true)
    expect(isMonthEnd('2024-02-29')).toBe(true)
    expect(isMonthEnd('2023-02-28')).toBe(true)
    expect(isMonthEnd('2024-02-28')).toBe(false)
    expect(isMonthEnd('2026-12-31')).toBe(true)
  })

  it('steps back a month across a year end', () => {
    expect(previousMonth('2026-11')).toBe('2026-10')
    expect(previousMonth('2026-01')).toBe('2025-12')
  })

  it('names a summary period the way the server does', () => {
    expect(periodLabel(2009, [1])).toBe('January 2009')
    expect(periodLabel(2023, [5, 6, 7])).toBe('May to July 2023')
    expect(periodLabel(2023, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('2023')
  })

  it('writes dates the way the page reads them', () => {
    expect(formatMonth('2023-06')).toBe('June 2023')
    expect(formatDate('2026-11-13')).toBe('13 November 2026')
  })
})
