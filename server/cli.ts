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

const save = process.argv.includes('--save')
const c = env()
if (!c.openAiKey) {
  console.error('Missing OPENAI_API_KEY (put it in .env.local; never in a VITE_ variable).')
  process.exit(1)
}
const date = editionToday()
console.log(`Edition date: ${date} (${c.timezone}) · model: ${c.model}\n`)

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
  const { stories, stats } = await runPipeline({ ai: openAiClient(c.openAiKey, c.model), today: date, log: console.log })
  console.log('\nStats:', stats)
  for (const s of stories) {
    console.log(`\n[${s.role} ${s.position}] ${s.category.toUpperCase()}  ${s.headline}\n  ${s.source_name} · ${s.source_published_at?.slice(0, 10) ?? 'date unknown'} · ${s.source_url}\n  ${s.summary}\n  why: ${s.ai_rationale}\n  check: ${s.claims_to_check.join(' | ')}`)
  }
  if (stories.length === 0) console.log('\nNo stories were produced.')
}
