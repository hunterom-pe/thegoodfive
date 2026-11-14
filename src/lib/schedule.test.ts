import { describe, expect, it } from 'vitest'
import { nextOccurrence, PHOENIX_UTC_OFFSET_HOURS, SCHEDULE, untilLabel } from './schedule'
import { todayISO } from './dates'

const phoenixHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Phoenix', hour: '2-digit', hourCycle: 'h23' }).format(d))

describe('schedule', () => {
  it('uses cron times that really are 4, 5, 7 and 8 AM in Phoenix, all year round (no daylight saving)', () => {
    for (const month of [0, 3, 6, 9, 11]) {
      for (const job of SCHEDULE) {
        const utcHour = Number(job.utcCron.split(' ')[1])
        const instant = new Date(Date.UTC(2026, month, 15, utcHour, 0))
        expect(phoenixHour(instant), `${job.key} in month ${month}`).toBe(job.hour)
      }
    }
    expect(PHOENIX_UTC_OFFSET_HOURS).toBe(-7)
  })
  it('finds the next 7:00 AM Phoenix, today or tomorrow', () => {
    // 05:00 Phoenix (12:00 UTC) -> 07:00 Phoenix the same day (14:00 UTC)
    expect(nextOccurrence(new Date('2026-11-14T12:00:00Z'), 7).toISOString()).toBe('2026-11-14T14:00:00.000Z')
    // 07:00 exactly has passed -> tomorrow
    expect(nextOccurrence(new Date('2026-11-14T14:00:00Z'), 7).toISOString()).toBe('2026-11-15T14:00:00.000Z')
    // 20:00 Phoenix (03:00 UTC next day) -> next morning
    expect(nextOccurrence(new Date('2026-11-15T03:00:00Z'), 7).toISOString()).toBe('2026-11-15T14:00:00.000Z')
  })
  it('handles month and year boundaries', () => {
    expect(nextOccurrence(new Date('2026-12-31T20:00:00Z'), 4).toISOString()).toBe('2027-01-01T11:00:00.000Z')
  })
  it('labels the wait', () => {
    expect(untilLabel(new Date('2026-11-14T12:00:00Z'), new Date('2026-11-14T14:20:00Z'))).toBe('in 2 h 20 min')
    expect(untilLabel(new Date('2026-11-14T12:00:00Z'), new Date('2026-11-14T12:40:00Z'))).toBe('in 40 min')
  })
})

describe('which day is "today": the Phoenix day, not the reader\'s or the server\'s', () => {
  it('flips at midnight Phoenix, which is 07:00 UTC', () => {
    expect(todayISO('America/Phoenix', new Date('2026-11-15T06:59:59Z'))).toBe('2026-11-14')
    expect(todayISO('America/Phoenix', new Date('2026-11-15T07:00:00Z'))).toBe('2026-11-15')
  })
  it('the 7:00 AM publish run and the 4:00 AM draft run always agree on the date', () => {
    for (const day of ['2026-01-02', '2026-03-08', '2026-11-01', '2026-12-31']) {
      const draft = new Date(`${day}T11:00:00Z`)
      const publish = new Date(`${day}T14:00:00Z`)
      expect(todayISO('America/Phoenix', draft)).toBe(day)
      expect(todayISO('America/Phoenix', publish)).toBe(day)
    }
  })
  it('a run that slips a few hours late is still on the same Phoenix day', () => {
    expect(todayISO('America/Phoenix', new Date('2026-11-14T20:00:00Z'))).toBe('2026-11-14') // 1:00 PM
  })
})
