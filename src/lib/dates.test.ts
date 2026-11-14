import { describe, expect, it } from 'vitest'
import { addDays, formatLong, isISODate, todayISO } from './dates'

describe('dates', () => {
  it('reads today on the publication clock, not the visitor clock', () => {
    const lateUtc = new Date('2026-11-13T23:30:00Z')
    expect(todayISO('UTC', lateUtc)).toBe('2026-11-13')
    expect(todayISO('Asia/Tokyo', lateUtc)).toBe('2026-11-14')
    expect(todayISO('America/Los_Angeles', lateUtc)).toBe('2026-11-13')
  })
  it('steps across month boundaries', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('formats a calendar day without shifting it', () => {
    expect(formatLong('2026-11-13')).toBe('Friday 13 November 2026')
  })
  it('validates edition dates', () => {
    expect(isISODate('2026-11-13')).toBe(true)
    expect(isISODate('2026-13-45')).toBe(false)
    expect(isISODate('yesterday')).toBe(false)
  })
  it('rejects impossible calendar days that look valid', () => {
    for (const bad of ['2026-02-30', '2026-02-29', '2026-04-31', '2026-06-31', '2026-00-10', '2026-01-00', '2026-1-5', '26-01-01']) expect(isISODate(bad), bad).toBe(false)
  })
  it('accepts real edge days, including leap day', () => {
    for (const ok of ['2028-02-29', '2026-02-28', '2026-12-31', '2026-01-01', '2000-02-29']) expect(isISODate(ok), ok).toBe(true)
    expect(isISODate('1900-02-29')).toBe(false)
  })
})
