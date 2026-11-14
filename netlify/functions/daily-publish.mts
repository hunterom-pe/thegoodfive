import type { Config } from '@netlify/functions'
import { scheduledPublish } from '../../server/scheduled.ts'

/**
 * 7:00 AM Phoenix (14:00 UTC). Publishes today's draft automatically, but only when
 * AUTO_PUBLISH_ENABLED=true and every verification check passes. Otherwise it records
 * why and leaves the latest published edition on the site.
 */
export default async () => {
  await scheduledPublish('schedule')
}

export const config: Config = { schedule: '0 14 * * *' }
