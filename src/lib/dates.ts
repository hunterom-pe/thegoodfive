/** The publication keeps one clock. Editions are dated in this timezone. */
export const EDITION_TIMEZONE: string = import.meta.env?.VITE_EDITION_TIMEZONE || 'America/Phoenix'

/** Today's date (YYYY-MM-DD) on the publication's clock. */
export function todayISO(timeZone: string = EDITION_TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
}

function fmt(date: string, options: Intl.DateTimeFormatOptions): string {
  // Edition dates are calendar days, not instants: format at UTC noon so no
  // reader's timezone can shift the day.
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
}

/** "Friday 13 November 2026" */
export const formatLong = (date: string) => fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '')
/** "13 Nov 2026" */
export const formatShort = (date: string) => fmt(date, { day: 'numeric', month: 'short', year: 'numeric' })
export const formatWeekday = (date: string) => fmt(date, { weekday: 'long' })
export const formatDayMonth = (date: string) => fmt(date, { day: 'numeric', month: 'long' })
export const formatMonthYear = (date: string) => fmt(date, { month: 'long', year: 'numeric' })
