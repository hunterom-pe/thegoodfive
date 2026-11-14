/**
 * Run the pipeline from your own machine.
 *
 *   npm run draft            dry run: discover, screen, write, print. Saves nothing.
 *   npm run draft -- --save  the same, then save the result as today's draft in Supabase.
 *
 * Needs OPENAI_API_KEY in .env.local; --save also needs SUPABASE_SERVICE_ROLE_KEY.
 */
import { openAiClient } from './pipeline/ai.ts'
import { runPipeline } from './pipeline/pipeline.ts'
import { admin, editionToday, env, executeRun, startRun } from './store.ts'

process.on('uncaughtException', (e) => {
  console.error(`\nFailed: ${e instanceof Error ? (e.name === 'TimeoutError' ? 'the AI provider took too long to answer. Set AI_REASONING_EFFORT=low or AI_TIMEOUT_SECONDS higher, or use a faster model.' : e.message) : e}`)
  process.exit(1)
})

const save = process.argv.includes('--save')
const c = env()
if (!c.openAiKey) {
  console.error('Missing OPENAI_API_KEY (put it in .env.local; never in a VITE_ variable).')
  process.exit(1)
}
const date = editionToday()
console.log(`Edition date: ${date} (${c.timezone}) · model: ${c.model} · ${new URL(c.aiBaseUrl).host}\n`)

if (save) {
  if (!c.supabaseUrl || !c.serviceKey) {
    console.error('--save needs SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }
  const db = admin()
  const run = await startRun(db, date, 'manual')
  if (!run.ok) {
    console.error(run.message)
    process.exit(1)
  }
  await executeRun(db, run.runId, date)
  const { data } = await db.from('discovery_runs').select('status, stats, error').eq('id', run.runId).single()
  console.log('\nResult:', data)
  process.exit(data?.status === 'succeeded' ? 0 : 1)
} else {
  const { stories, stats } = await runPipeline({ ai: openAiClient(c.openAiKey, c.model, c.aiBaseUrl, { reasoningEffort: c.reasoningEffort, timeoutSeconds: c.aiTimeoutSeconds, log: console.log }), today: date, log: console.log, images: { unsplashKey: c.unsplashKey || undefined, appName: c.appName, log: console.log, notify: false } })
  console.log('\nStats:', stats)
  for (const s of stories) {
    console.log(`\n[${s.role} ${s.position}] ${s.category.toUpperCase()}  ${s.headline}\n  ${s.source_name} · ${s.source_published_at?.slice(0, 10) ?? 'date unknown'} · ${s.source_url}\n  ${s.summary}\n  why: ${s.ai_rationale}\n  check: ${s.claims_to_check.join(' | ')}\n  photo: ${s.image_url ? `${s.image_kind} · ${s.image_source} · ${s.image_credit ?? 'no credit'} · ${s.image_rights_confirmed ? 'APPROVED' : 'NOT APPROVED'} · ${s.image_url.slice(0, 80)}` : 'none (geometric fallback)'} · candidates: ${s.image_candidates?.length ?? 0}`)
  }
  if (stories.length === 0) console.log('\nNo stories were produced.')
}
