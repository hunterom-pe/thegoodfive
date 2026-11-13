import type { Config } from '@netlify/functions'
import { admin, env, executeRun, missingConfig } from '../../server/store.ts'

/**
 * Background function (the "-background" suffix gives it up to 15 minutes).
 * It cannot be called by the public: it requires the shared secret that only
 * our other functions know.
 */
export default async (req: Request) => {
  const c = env()
  if (!c.secret || req.headers.get('x-generation-secret') !== c.secret) return new Response('Forbidden', { status: 403 })
  const { runId, date } = (await req.json().catch(() => ({}))) as { runId?: string; date?: string }
  if (!runId || !date) return new Response('Bad request', { status: 400 })
  if (missingConfig().length) return new Response('Not configured', { status: 500 })
  await executeRun(admin(), runId, date)
  return new Response('Done', { status: 202 })
}

export const config: Config = {}
