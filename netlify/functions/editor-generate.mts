import { admin, editionToday, env, missingConfig, startRun, triggerBackground } from '../../server/store.ts'

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * "Generate Today's Five". The browser sends the editor's Supabase session
 * token; we verify it here, on the server, and check the editors table.
 * A signed-in stranger gets 403. Nothing client-side is trusted.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { message: 'Use POST.' })
  const missing = missingConfig()
  if (missing.length || !env().secret) return json(503, { message: `Generation isn’t configured on the server. Missing: ${[...missing, ...(env().secret ? [] : ['GENERATION_SECRET'])].join(', ')}.` })

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { message: 'Sign in again.' })
  const db = admin()
  const { data: auth, error } = await db.auth.getUser(token)
  if (error || !auth.user) return json(401, { message: 'Your session has expired. Sign in again.' })
  const { data: editor } = await db.from('editors').select('user_id').eq('user_id', auth.user.id).maybeSingle()
  if (!editor) return json(403, { message: 'This account is not an editor.' })

  const date = editionToday()
  const run = await startRun(db, date, 'manual')
  if (!run.ok) return json(run.status, { message: run.message })
  const started = await triggerBackground(db, run.runId, run.date)
  if (!started.ok) return json(502, { message: started.message })
  return json(202, { runId: run.runId, date: run.date, message: 'Generation started.' })
}
