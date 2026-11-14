import type { Config } from '@netlify/functions'
import { scheduledDraft } from '../../server/scheduled.ts'

/** 5:00 AM Phoenix (12:00 UTC): a second chance if 4:00 AM failed. Does nothing (and costs nothing) if a draft already exists. */
export default async () => {
  await scheduledDraft('retry')
}

export const config: Config = { schedule: '0 12 * * *' }
