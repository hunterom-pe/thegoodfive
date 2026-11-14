import type { Config } from '@netlify/functions'
import { scheduledDraft } from '../../server/scheduled.ts'

/** 4:00 AM Phoenix (11:00 UTC; Arizona has no daylight saving). Prepares, never publishes. */
export default async () => {
  await scheduledDraft('schedule')
}

export const config: Config = { schedule: '0 11 * * *' }
