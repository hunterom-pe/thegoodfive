import type { Config } from '@netlify/functions'
import { admin, editionToday, env, missingConfig, startRun, triggerBackground } from '../../server/store.ts'

/**
 * Runs once a day and prepares (never publishes) the day's draft.
 * 11:00 UTC is 4 a.m. in America/Phoenix, which has no daylight saving.
 * If you change EDITION_TIMEZONE, adjust the cron time to suit.
 */
export default async () => {
  if (missingConfig().length || !env().secret) {
    console.error('daily-draft: not configured. Missing:', [...missingConfig(), ...(env().secret ? [] : ['GENERATION_SECRET'])].join(', '))
    return
  }
  const db = admin()
  const run = await startRun(db, editionToday(), 'schedule')
  if (!run.ok) return console.log(`daily-draft: skipped. ${run.message}`)
  const started = await triggerBackground(db, run.runId, run.date)
  if (!started.ok) console.error('daily-draft:', started.message)
}

export const config: Config = { schedule: '0 11 * * *' }
