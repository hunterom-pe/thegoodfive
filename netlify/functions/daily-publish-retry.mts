import type { Config } from '@netlify/functions'
import { scheduledPublish } from '../../server/scheduled.ts'

/** 8:00 AM Phoenix (15:00 UTC): one retry. Harmless if the 7:00 AM run already published (it is idempotent). */
export default async () => {
  await scheduledPublish('retry')
}

export const config: Config = { schedule: '0 15 * * *' }
