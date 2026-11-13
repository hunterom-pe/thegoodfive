import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { openAiClient } from './pipeline/ai.ts'
import { runPipeline } from './pipeline/pipeline.ts'

/** Server-side configuration. None of these are ever sent to a browser. */
export function env() {
  const e = process.env
  return {
    supabaseUrl: (e.SUPABASE_URL || e.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: e.SUPABASE_SERVICE_ROLE_KEY || '',
    openAiKey: e.OPENAI_API_KEY || '',
    model: e.OPENAI_MODEL || 'gpt-4.1-mini',
    aiBaseUrl: e.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    secret: e.GENERATION_SECRET || '',
    timezone: e.EDITION_TIMEZONE || e.VITE_EDITION_TIMEZONE || 'America/Phoenix',
    maxRunsPerDay: Number(e.MAX_RUNS_PER_DAY || 4),
    siteUrl: (e.URL || e.SITE_URL || 'http://localhost:8888').replace(/\/$/, ''),
  }
}

export function missingConfig(): string[] {
  const c = env()
  return [!c.supabaseUrl && 'SUPABASE_URL', !c.serviceKey && 'SUPABASE_SERVICE_ROLE_KEY', !c.openAiKey && 'OPENAI_API_KEY'].filter(Boolean) as string[]
}

export function admin(): SupabaseClient {
  const c = env()
  return createClient(c.supabaseUrl, c.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Today's date on the publication's clock (the edition timezone, default America/Phoenix). */
export function editionToday(timeZone = env().timezone, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export type StartResult = { ok: true; runId: string; date: string } | { ok: false; status: 409 | 429 | 500; message: string }

/**
 * Claim the right to generate a draft for `date`. Refuses, with a reason, when
 * an edition is already published or has stories, when a run is already in
 * progress, or when the day's run budget is spent. The unique index on
 * running rows makes the claim safe even if two requests arrive together.
 */
export async function startRun(db: SupabaseClient, date: string, trigger: 'schedule' | 'manual'): Promise<StartResult> {
  const cap = env().maxRunsPerDay

  // A run that died without reporting (e.g. the platform killed it) must not block tomorrow.
  await db
    .from('discovery_runs')
    .update({ status: 'failed', error: 'Run did not finish and was marked failed.', finished_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 20 * 60_000).toISOString())

  const { data: edition } = await db.from('editions').select('id, status, stories(id)').eq('edition_date', date).maybeSingle()
  if (edition?.status === 'published') return { ok: false, status: 409, message: `The edition for ${date} is already published, so it won’t be changed.` }
  if (edition && (edition.stories as unknown[]).length > 0) return { ok: false, status: 409, message: `The edition for ${date} already has stories. Generation only fills an empty draft, so your work is safe.` }

  const { count } = await db.from('discovery_runs').select('id', { count: 'exact', head: true }).eq('edition_date', date).neq('status', 'skipped')
  if ((count ?? 0) >= cap) return { ok: false, status: 429, message: `Today’s limit of ${cap} generation runs has been reached.` }

  const { data, error } = await db.from('discovery_runs').insert({ edition_date: date, status: 'running', trigger }).select('id').single()
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, message: 'A generation run is already in progress.' }
    return { ok: false, status: 500, message: `Could not start a run: ${error.message}` }
  }
  return { ok: true, runId: data.id as string, date }
}

async function finish(db: SupabaseClient, runId: string, status: 'succeeded' | 'skipped' | 'failed', stats: Record<string, unknown>, error?: string) {
  await db.from('discovery_runs').update({ status, stats, error: error ?? null, finished_at: new Date().toISOString() }).eq('id', runId)
}

/** Run the whole pipeline and store the result as an unpublished draft. Never throws; the outcome is recorded on the run. */
export async function executeRun(db: SupabaseClient, runId: string, date: string, log: (line: string) => void = console.log): Promise<void> {
  const stats: Record<string, unknown> = {}
  try {
    const c = env()
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    const { data: recent } = await db.from('stories').select('source_url, editions!inner(edition_date)').gte('editions.edition_date', since).neq('role', 'rejected')
    const recentUrls = (recent ?? []).map((r) => r.source_url as string)

    const result = await runPipeline({ ai: openAiClient(c.openAiKey, c.model, c.aiBaseUrl), today: date, recentUrls, log })
    Object.assign(stats, result.stats)
    if (result.stories.length === 0) return await finish(db, runId, 'skipped', stats, 'No suitable stories were found. Nothing was saved.')

    const { data: editionId, error } = await db.rpc('create_draft_edition', { p_date: date, p_stories: result.stories })
    if (error) throw new Error(error.message)
    if (!editionId) return await finish(db, runId, 'skipped', stats, 'The edition changed while generating, so nothing was saved.')
    await finish(db, runId, 'succeeded', stats)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log(`Run failed: ${message}`)
    await finish(db, runId, 'failed', stats, message.slice(0, 500))
  }
}

/** Hand the slow work to the background function, which may run for minutes. */
export async function triggerBackground(db: SupabaseClient, runId: string, date: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = env()
  try {
    const res = await fetch(`${c.siteUrl}/.netlify/functions/generate-draft-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-generation-secret': c.secret },
      body: JSON.stringify({ runId, date }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 202 || res.ok) return { ok: true }
    throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    const message = `The background job could not be started (${e instanceof Error ? e.message : e}).`
    await finish(db, runId, 'failed', {}, message)
    return { ok: false, message }
  }
}
