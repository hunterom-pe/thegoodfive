import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { openAiClient } from './pipeline/ai.ts'
import { runPipeline } from './pipeline/pipeline.ts'
import { webhookNotifier } from './alerts.ts'
import { aiConfig } from './pipeline/gemini.ts'
import { aiClaimVerifier, type ClaimVerifier } from './pipeline/verify.ts'
import type { LibraryPhoto } from './pipeline/library.ts'

/** Server-side configuration. None of these are ever sent to a browser. */
export function env() {
  const e = process.env
  const ai = aiConfig(e)
  return {
    supabaseUrl: (e.SUPABASE_URL || e.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: e.SUPABASE_SERVICE_ROLE_KEY || '',
    aiKey: ai.key,
    aiKeySource: ai.keySource,
    aiProvider: ai.provider,
    unsplashKey: e.UNSPLASH_ACCESS_KEY || '',
    appName: e.UNSPLASH_APP_NAME || 'thegoodfive',
    model: ai.model,
    reasoningEffort: e.AI_REASONING_EFFORT || undefined,
    aiTimeoutSeconds: Number(e.AI_TIMEOUT_SECONDS || 240),
    aiBaseUrl: ai.baseUrl,
    secret: e.GENERATION_SECRET || '',
    timezone: e.EDITION_TIMEZONE || e.VITE_EDITION_TIMEZONE || 'America/Phoenix',
    autoPublish: (e.AUTO_PUBLISH_ENABLED ?? '').trim().toLowerCase() === 'true',
    alertWebhook: e.ALERT_WEBHOOK_URL || '',
    extraTrusted: e.EXTRA_TRUSTED_DOMAINS || '',
    runDeadlineMs: Number(e.RUN_DEADLINE_MS) || RUN_DEADLINE_MS,
    aiRetryDelays: (e.AI_RETRY_DELAYS_MS ?? '').split(',').filter((x) => x.trim() !== '').map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0),
    maxRunsPerDay: Number(e.MAX_RUNS_PER_DAY || 4),
    siteUrl: (e.URL || e.SITE_URL || 'http://localhost:8888').replace(/\/$/, ''),
  }
}

export function missingConfig(): string[] {
  const c = env()
  return [!c.supabaseUrl && 'SUPABASE_URL', !c.serviceKey && 'SUPABASE_SERVICE_ROLE_KEY', !c.aiKey && 'GEMINI_API_KEY (or OPENAI_API_KEY)'].filter(Boolean) as string[]
}

export function admin(): SupabaseClient {
  const c = env()
  return createClient(c.supabaseUrl, c.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Today's date on the publication's clock (the edition timezone, default America/Phoenix). */
export function editionToday(timeZone = env().timezone, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Well inside Netlify's 15-minute background limit. */
export const RUN_DEADLINE_MS = 13 * 60_000

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
    const { data: runRow } = await db.from('discovery_runs').select('trigger').eq('id', runId).single()
    // Unsplash's API terms ask for non-automated use: only a run an editor started may search for photos.
    // Scheduled runs leave images to the editor (their own photo search) or to the geometric artwork.
    const personPresent = runRow?.trigger === 'manual'
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    const { data: recent } = await db.from('stories').select('source_url, editions!inner(edition_date)').gte('editions.edition_date', since).neq('role', 'rejected')
    const recentUrls = (recent ?? []).map((r) => r.source_url as string)
    const library = await loadLibrary(db)

    // Netlify stops background functions at 15 minutes with no word. Stop ourselves first, so the run is
    // recorded as failed with a clear reason and the editor's page (which waits 16 minutes) hears about it.
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`The run took longer than ${Math.round(c.runDeadlineMs / 60_000)} minutes and was stopped. Try again, or use a faster AI model.`)), c.runDeadlineMs)
    })
    const result = await Promise.race([deadline, runPipeline({ ai: openAiClient(c.aiKey, c.model, c.aiBaseUrl, { keySource: c.aiKeySource, reasoningEffort: c.reasoningEffort, timeoutSeconds: c.aiTimeoutSeconds, retryDelaysMs: c.aiRetryDelays.length ? c.aiRetryDelays : undefined, log: console.log }), today: date, recentUrls, log, extraTrustedDomains: c.extraTrusted, images: { unsplashKey: personPresent ? c.unsplashKey || undefined : undefined, noticeKey: c.unsplashKey || undefined, library, today: date, appName: c.appName, log } })]).finally(() => clearTimeout(timer))
    Object.assign(stats, result.stats)
    if (result.stories.length === 0) {
      await webhookNotifier(c.alertWebhook)(`Draft generation for ${date} found no suitable stories. Nothing was saved.`)
      return await finish(db, runId, 'skipped', stats, 'No suitable stories were found. Nothing was saved.')
    }

    const { data: editionId, error } = await db.rpc('create_draft_edition', { p_date: date, p_stories: result.stories })
    if (error) throw new Error(error.message)
    if (!editionId) return await finish(db, runId, 'skipped', stats, 'The edition changed while generating, so nothing was saved.')
    await recordLibraryUse(db, editionId as string, date, result.stories, log)
    await finish(db, runId, 'succeeded', stats)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log(`Run failed: ${message}`)
    await webhookNotifier(env().alertWebhook)(`Draft generation for ${date} failed: ${message.slice(0, 300)}`)
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

/** Verify an editor's session token server-side. Returns the user id, or the HTTP error to send back. */
export async function authenticateEditor(db: SupabaseClient, authorization: string | null): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; message: string }> {
  const token = (authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return { ok: false, status: 401, message: 'Sign in again.' }
  const { data: auth, error } = await db.auth.getUser(token)
  if (error || !auth.user) return { ok: false, status: 401, message: 'Your session has expired. Sign in again.' }
  const { data: editor } = await db.from('editors').select('user_id').eq('user_id', auth.user.id).maybeSingle()
  if (!editor) return { ok: false, status: 403, message: 'This account is not an editor.' }
  return { ok: true, userId: auth.user.id }
}

// ── Publishing storage (Supabase) ──────────────────────────────────────────
import type { PublishDecision, PublishRunRecord, PublishStore, StoredEdition, StoredStory } from './autopublish.ts'

export function supabasePublishStore(db: SupabaseClient): PublishStore {
  return {
    async loadEdition(date) {
      const { data, error } = await db
        .from('editions')
        .select('id, edition_date, status, stories(id, role, position, headline, summary, category, source_name, source_url, source_published_at, source_material, ai_rationale)')
        .eq('edition_date', date)
        .maybeSingle()
      if (error) throw new Error(`Could not read the edition: ${error.message}`)
      if (!data) return null
      const rows = data.stories as Record<string, unknown>[]
      return {
        id: data.id as string,
        date: data.edition_date as string,
        status: data.status as StoredEdition['status'],
        stories: rows.map((r): StoredStory => ({
          id: r.id as string, role: r.role as StoredStory['role'], position: (r.position as number | null) ?? null,
          headline: (r.headline as string) ?? '', summary: (r.summary as string) ?? '', category: r.category as string,
          sourceName: (r.source_name as string) ?? '', sourceUrl: (r.source_url as string) ?? '',
          sourcePublishedAt: (r.source_published_at as string | null) ?? null, sourceMaterial: (r.source_material as string | null) ?? null,
          aiRationale: (r.ai_rationale as string | null) ?? null,
        })),
      }
    },
    async recentSourceUrls(date) {
      const since = new Date(Date.parse(`${date}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await db
        .from('stories')
        .select('source_url, editions!inner(edition_date, status)')
        .eq('editions.status', 'published')
        .gte('editions.edition_date', since)
        .lt('editions.edition_date', date)
      if (error) throw new Error(`Could not read recent editions: ${error.message}`)
      return (data ?? []).map((r) => r.source_url as string)
    },
    async publish(editionId, date, primary, rejections): Promise<PublishDecision> {
      const { data, error } = await db.rpc('auto_publish_edition', { p_edition: editionId, p_date: date, p_primary: primary, p_rejections: rejections })
      if (error) throw new Error(error.message)
      return data as PublishDecision
    },
    async record(run: PublishRunRecord) {
      const { error } = await db.from('publish_runs').insert({ edition_date: run.date, status: run.status, trigger: run.trigger, reason: run.reason, details: run.details, finished_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
    },
  }
}

/**
 * The claim verifier for automatic publishing. Fast and unforgiving: one short attempt per story
 * (a scheduled function has about 30 seconds), and any failure means "could not confirm", which holds
 * the edition for an editor. Undefined when no AI key is configured, which also holds it.
 */
export function claimVerifier(): ClaimVerifier | undefined {
  const c = env()
  if (!c.aiKey) return undefined
  return aiClaimVerifier(openAiClient(c.aiKey, c.model, c.aiBaseUrl, { keySource: c.aiKeySource, reasoningEffort: c.reasoningEffort, timeoutSeconds: 18, retryDelaysMs: [1_000] }))
}

const photoFrom = (r: Record<string, unknown>): LibraryPhoto => ({
  id: r.id as string, unsplashId: r.unsplash_id as string, url: r.url as string, alt: r.alt as string, credit: r.credit as string,
  creditUrl: r.credit_url as string, sourceUrl: r.source_url as string, downloadLocation: (r.download_location as string | null) ?? null,
  categories: (r.categories as string[]) ?? [], keywords: (r.keywords as string[]) ?? [], generic: Boolean(r.generic), showsPeople: Boolean(r.shows_people),
  lastUsedOn: (r.last_used_on as string | null) ?? null,
})

/** The photos editors saved for reuse. A missing table (migration not run yet) or any error just means no library. */
export async function loadLibrary(db: SupabaseClient): Promise<LibraryPhoto[]> {
  const { data, error } = await db.from('photo_library').select('*').eq('active', true)
  if (error) {
    console.log(`Photo library unavailable: ${error.message}`)
    return []
  }
  return (data ?? []).map(photoFrom)
}

/**
 * A photo an editor saved to the library was already approved by that editor, so the story it was given
 * to carries that approval (this is what lets it appear in an automatically published edition). Also
 * records the use, so the photo rests before it appears again.
 */
async function recordLibraryUse(db: SupabaseClient, editionId: string, date: string, stories: { source_url: string; image_library_id?: string | null }[], log: (line: string) => void) {
  const used = stories.filter((s) => s.image_library_id)
  for (const s of used) {
    const { error } = await db.from('stories').update({ image_editor_approved: true }).eq('edition_id', editionId).eq('source_url', s.source_url)
    if (error) log(`Could not mark a library photo as approved: ${error.message}`)
    const { data: row } = await db.from('photo_library').select('use_count').eq('id', s.image_library_id!).single()
    await db.from('photo_library').update({ last_used_on: date, use_count: ((row?.use_count as number | undefined) ?? 0) + 1 }).eq('id', s.image_library_id!)
  }
}
