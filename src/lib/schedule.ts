/**
 * The daily schedule, in the publication's timezone (America/Phoenix). Arizona does
 * not observe daylight saving time, so Phoenix is always UTC-7 and the cron times
 * below never need adjusting. Keep in step with the `schedule` in netlify/functions/*.
 */
export const PHOENIX_UTC_OFFSET_HOURS = -7

export const SCHEDULE = [
  { key: 'draft', label: 'Find and write the draft', hour: 4, utcCron: '0 11 * * *' },
  { key: 'draft-retry', label: 'Draft retry (only if needed)', hour: 5, utcCron: '0 12 * * *' },
  { key: 'publish', label: 'Check and publish', hour: 7, utcCron: '0 14 * * *' },
  { key: 'publish-retry', label: 'Publish retry (only if needed)', hour: 8, utcCron: '0 15 * * *' },
] as const

/** The next moment, at or after `now`, when it is `hour`:00 in Phoenix. */
export function nextOccurrence(now: Date, hour: number): Date {
  const phoenixNow = new Date(now.getTime() + PHOENIX_UTC_OFFSET_HOURS * 3_600_000)
  const next = new Date(Date.UTC(phoenixNow.getUTCFullYear(), phoenixNow.getUTCMonth(), phoenixNow.getUTCDate(), hour))
  if (next.getTime() <= phoenixNow.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return new Date(next.getTime() - PHOENIX_UTC_OFFSET_HOURS * 3_600_000)
}

/** "in 5 h 20 min" / "in 40 min" */
export function untilLabel(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
  const h = Math.floor(minutes / 60)
  return h > 0 ? `in ${h} h ${minutes % 60} min` : `in ${minutes} min`
}
