import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { openAiClient } from './pipeline/ai.ts'
import { runPipeline } from './pipeline/pipeline.ts'
import { trackedNotifier, webhookNotifier } from './alerts.ts'
import { aiConfig } from './pipeline/gemini.ts'
import { aiClaimVerifier, type ClaimVerifier, type Verification } from './pipeline/verify.ts'
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
    /** Pause between claim checks at draft time (CLAIM_CHECK_GAP_MS; default 4.5s, about 13 a minute at most). */
    claimCheckGapMs: Number.isFinite(Number(e.CLAIM_CHECK_GAP_MS)) && e.CLAIM_CHECK_GAP_MS !== undefined && e.CLAIM_CHECK_GAP_MS !== '' ? Math.max(0, Number(e.CLAIM_CHECK_GAP_MS)) : 4_500,
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
  const stale = await db
    .from('discovery_runs')
    .update({ status: 'failed', error: 'Run did not finish and was marked failed.', finished_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 20 * 60_000).toISOString())
  // Every check below protects against a bad run (a duplicate, a published day, a runaway AI bill).
  // If one cannot be completed, do NOT start: an unreadable answer is not "all clear".
  if (stale.error) return { ok: false, status: 500, message: `Could not check earlier runs, so no run was started: ${stale.error.message}` }

  const { data: edition, error: editionError } = await db.from('editions').select('id, status, stories(id)').eq('edition_date', date).maybeSingle()
  if (editionError) return { ok: false, status: 500, message: `Could not check the existing edition, so no run was started: ${editionError.message}` }
  if (edition?.status === 'published') return { ok: false, status: 409, message: `The edition for ${date} is already published, so it won’t be changed.` }
  if (edition && (edition.stories as unknown[]).length > 0) return { ok: false, status: 409, message: `The edition for ${date} already has stories. Generation only fills an empty draft, so your work is safe.` }

  const { count, error: budgetError } = await db.from('discovery_runs').select('id', { count: 'exact', head: true }).eq('edition_date', date).neq('status', 'skipped')
  if (budgetError || count === null || count === undefined) return { ok: false, status: 500, message: `Could not read today’s run budget, so no run was started: ${budgetError?.message ?? 'no count returned'}` }
  if (count >= cap) return { ok: false, status: 429, message: `Today’s limit of ${cap} generation runs has been reached.` }

  const { data, error } = await db.from('discovery_runs').insert({ edition_date: date, status: 'running', trigger }).select('id').single()
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, message: 'A generation run is already in progress.' }
    return { ok: false, status: 500, message: `Could not start a run: ${error.message}` }
  }
  return { ok: true, runId: data.id as string, date }
}

/**
 * Write a run's outcome down. If that fails the run stays "running" until the stale-run cleanup, so the
 * failure is logged and alerted rather than swallowed; it never throws, so cleanup always completes.
 */
async function finish(db: SupabaseClient, runId: string, status: 'succeeded' | 'skipped' | 'failed', stats: Record<string, unknown>, error?: string, notify?: (message: string) => Promise<void>) {
  const { error: writeError } = await db.from('discovery_runs').update({ status, stats, error: error ?? null, finished_at: new Date().toISOString() }).eq('id', runId)
  if (writeError) {
    console.error(`draft: could not record the run outcome (${status}): ${writeError.message.slice(0, 200)}`)
    await notify?.(`A draft run finished as "${status}" but its outcome could not be saved (${writeError.message.slice(0, 160)}). It will show as running until it is cleaned up.`)
  }
}

/** Run the whole pipeline and store the result as an unpublished draft. Never throws; the outcome is recorded on the run. */
export async function executeRun(db: SupabaseClient, runId: string, date: string, log: (line: string) => void = console.log, deps: { verify?: ClaimVerifier } = {}): Promise<void> {
  const stats: Record<string, unknown> = {}
  const c0 = env()
  // Alerts that cannot be delivered are remembered and stored with the run, so nobody has to guess whether they were told.
  const tracked = trackedNotifier(webhookNotifier(c0.alertWebhook))
  const alertNote = () => (tracked.failures.length ? { alertFailures: [...tracked.failures] } : {})
  const startedAt = Date.now()
  const job = new AbortController()
  let jobTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const c = env()
    const { data: runRow, error: runError } = await db.from('discovery_runs').select('trigger').eq('id', runId).single()
    if (runError) throw new Error(`Could not read the run: ${runError.message}`)
    // Unsplash's API terms ask for non-automated use: only a run an editor started may search for photos.
    // Scheduled runs leave images to the editor (their own photo search) or to the geometric artwork.
    const personPresent = runRow?.trigger === 'manual'
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    const { data: recent, error: recentError } = await db.from('stories').select('source_url, editions!inner(edition_date)').gte('editions.edition_date', since).neq('role', 'rejected')
    // Without the recent articles we cannot avoid repeating one, so stop instead of guessing.
    if (recentError) throw new Error(`Could not read recent editions, so no draft was written: ${recentError.message}`)
    const recentUrls = (recent ?? []).map((r) => r.source_url as string)
    const library = await loadLibrary(db)

    // Netlify stops background functions at 15 minutes with no word. One clock covers the whole job (finding,
    // writing, saving and the draft-time claim checks): it expires `reserve` before the limit, so the outcome can
    // still be recorded and the alert sent. Expiry also cancels the unfinished AI calls and stages.
    const total = c.runDeadlineMs
    const reserve = Math.min(FINISH_RESERVE_MS, Math.floor(total / 10))
    const limit = startedAt + total - reserve
    jobTimer = setTimeout(() => job.abort(new Error(`The run took longer than ${Math.round(total / 60_000)} minutes and was stopped. Try again, or use a faster AI model.`)), Math.max(0, limit - Date.now()))
    const result = await untilAborted(job.signal, runPipeline({ ai: openAiClient(c.aiKey, c.model, c.aiBaseUrl, { keySource: c.aiKeySource, reasoningEffort: c.reasoningEffort, timeoutSeconds: c.aiTimeoutSeconds, retryDelaysMs: c.aiRetryDelays.length ? c.aiRetryDelays : undefined, log: console.log }), today: date, recentUrls, log, signal: job.signal, extraTrustedDomains: c.extraTrusted, images: { unsplashKey: personPresent ? c.unsplashKey || undefined : undefined, noticeKey: c.unsplashKey || undefined, library, today: date, appName: c.appName, log } }))
    Object.assign(stats, result.stats)
    if (result.stories.length === 0) {
      await tracked.notify(`Draft generation for ${date} found no suitable stories. Nothing was saved.`)
      return await finish(db, runId, 'skipped', { ...stats, ...alertNote() }, 'No suitable stories were found. Nothing was saved.', tracked.notify)
    }

    const { data: editionId, error } = await untilAborted(job.signal, Promise.resolve(db.rpc('create_draft_edition', { p_date: date, p_stories: result.stories })))
    if (error) throw new Error(error.message)
    if (!editionId) return await finish(db, runId, 'skipped', { ...stats, ...alertNote() }, 'The edition changed while generating, so nothing was saved.', tracked.notify)
    // The draft is saved. What follows is best effort within the same clock: running out of time here must not
    // turn a saved draft into a failed run. Unchecked stories are simply checked at 7:00 AM.
    await untilAborted(job.signal, recordLibraryUse(db, editionId as string, date, result.stories, log)).catch((e) => log(`Photo use not recorded: ${e instanceof Error ? e.message : e}`))
    // Check every story's claims now, while there is time, so 7:00 AM does not depend on the AI being quick then.
    const claimBudget = Math.min(CLAIM_CHECK_BUDGET_MS, limit - Date.now())
    Object.assign(stats, { claimChecks: await storeDraftClaimChecks(db, date, deps.verify ?? draftClaimVerifier(), log, { gapMs: env().claimCheckGapMs, budgetMs: claimBudget, signal: job.signal }) })
    // Photos are expected every day: say so loudly when a story will run without one.
    const bare = result.stories.filter((s) => s.role === 'primary' && !s.image_rights_confirmed).length
    if (bare > 0) await tracked.notify(`The draft for ${date} has ${bare} of 5 stories without an approved photo (they will show artwork). Add photos in the editor, or save more to the photo library.`)
    await finish(db, runId, 'succeeded', { ...stats, ...alertNote() }, undefined, tracked.notify)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log(`Run failed: ${message}`)
    await tracked.notify(`Draft generation for ${date} failed: ${message.slice(0, 300)}`)
    await finish(db, runId, 'failed', { ...stats, ...alertNote() }, message.slice(0, 500), tracked.notify)
  } finally {
    clearTimeout(jobTimer)
  }
}

/** Time kept back from the whole-job limit for recording the outcome and sending the alert. */
export const FINISH_RESERVE_MS = 60_000
/** The most the draft-time claim checks may take, whatever time is left. */
const CLAIM_CHECK_BUDGET_MS = 4 * 60_000

/** Settle with the work, or reject as soon as the signal fires (the work is left to be cancelled by its own signal). */
function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return void reject(signal.reason)
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
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
import { contentHash, eachLimited, type PublishDecision, type PublishRunRecord, type PublishStore, type StoredClaimCheck, type StoredEdition, type StoredStory } from './autopublish.ts'

export function supabasePublishStore(db: SupabaseClient): PublishStore {
  return {
    async loadEdition(date) {
      const columns = 'id, role, position, headline, summary, category, source_name, source_url, source_published_at, source_material, ai_rationale, image_url, image_rights_confirmed, image_source, image_editor_approved'
      const read = (withChecks: boolean) =>
        db.from('editions').select(`id, edition_date, status, stories(${columns}${withChecks ? ', claim_check' : ''})`).eq('edition_date', date).maybeSingle()
      let { data, error } = await read(true)
      // Before migration 20261120000000 the column does not exist: read without it (every story is then checked now).
      if (error && /claim_check/.test(error.message)) ({ data, error } = await read(false))
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
          hasPublicPhoto: Boolean(r.image_url && r.image_rights_confirmed && (r.image_source !== 'unsplash' || r.image_editor_approved)),
          claimCheck: parseStoredCheck(r.claim_check),
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
    async publish(editionId, date, primary, rejections, checked): Promise<PublishDecision> {
      const { data, error } = await db.rpc('auto_publish_edition', { p_edition: editionId, p_date: date, p_primary: primary, p_rejections: rejections, p_checked: checked })
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
  return aiClaimVerifier(openAiClient(c.aiKey, c.model, c.aiBaseUrl, { keySource: c.aiKeySource, reasoningEffort: c.reasoningEffort, timeoutSeconds: 15, retryDelaysMs: c.aiRetryDelays.length ? c.aiRetryDelays.slice(0, 1) : [1_500] }))
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
    const { data: row, error: readError } = await db.from('photo_library').select('use_count').eq('id', s.image_library_id!).single()
    const { error: useError } = readError ? { error: readError } : await db.from('photo_library').update({ last_used_on: date, use_count: ((row?.use_count as number | undefined) ?? 0) + 1 }).eq('id', s.image_library_id!)
    if (useError) log(`Could not record the use of a library photo (it may repeat sooner): ${useError.message}`)
  }
}

/** A stored claim check, or null if it is missing or malformed (then the story is simply checked again). */
export function parseStoredCheck(raw: unknown): StoredClaimCheck | null {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!r || typeof r.hash !== 'string' || !['verified', 'contradicted', 'inconclusive'].includes(r.verdict as string)) return null
  return {
    verdict: r.verdict as StoredClaimCheck['verdict'],
    issues: Array.isArray(r.issues) ? r.issues.filter((i): i is string => typeof i === 'string').slice(0, 30) : [],
    unavailable: r.unavailable === true,
    hash: r.hash,
    checkedAt: typeof r.checkedAt === 'string' ? r.checkedAt : '',
  }
}

/**
 * At draft time, with minutes to spare: check every candidate's claims and store each result with the fingerprint
 * of the text it read, for the 7:00 AM publisher to reuse. Slow and patient on purpose (a few at a time, generous
 * timeouts and retries). Never throws and never blocks the draft: a failure only means 7:00 AM checks that story.
 */
export async function storeDraftClaimChecks(db: SupabaseClient, date: string, verify: ClaimVerifier | undefined, log: (line: string) => void = () => {}, options: { gapMs?: number; budgetMs?: number; signal?: AbortSignal } = {}): Promise<{ checked: number; stored: number }> {
  if (!verify) return { checked: 0, stored: 0 }
  if (options.budgetMs !== undefined && options.budgetMs <= 0) {
    log('Claim checks skipped: no time left in this run. They will be made at publish time.')
    return { checked: 0, stored: 0 }
  }
  let edition: StoredEdition | null = null
  try {
    edition = await supabasePublishStore(db).loadEdition(date)
  } catch (e) {
    log(`Claim checks skipped: ${e instanceof Error ? e.message : e}`)
    return { checked: 0, stored: 0 }
  }
  if (!edition || edition.status === 'published') return { checked: 0, stored: 0 }
  const candidates = edition.stories.filter((s) => s.role !== 'rejected')
  let stored = 0
  // One at a time, a few seconds apart: the free Gemini tier allows 15 requests a minute, and the draft run has
  // already used two. Eight stories take well under a minute, inside the background function's 15 minutes.
  const gap = options.gapMs ?? 4_500
  // An overall limit, so a struggling AI provider can never keep the background function running until the
  // platform kills it (it has 15 minutes in all, and the pipeline has already used some). Unchecked stories are
  // simply checked at 7:00 AM.
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new Error('The draft-time claim checks ran out of time.')), options.budgetMs ?? CLAIM_CHECK_BUDGET_MS)
  // The whole job's clock stops these too, even if its budget has not run out.
  options.signal?.addEventListener('abort', () => deadline.abort(options.signal?.reason), { once: true })
  await eachLimited(candidates, 1, async (s) => {
    if (deadline.signal.aborted) return
    if (candidates.indexOf(s) > 0 && gap > 0) await untilAborted(deadline.signal, new Promise((r) => setTimeout(r, gap))).catch(() => {})
    if (deadline.signal.aborted) return
    const v = await untilAborted(deadline.signal, Promise.resolve(verify({ headline: s.headline, summary: s.summary, material: s.sourceMaterial ?? '' }, deadline.signal))).catch((e): Verification => ({ verdict: 'inconclusive', unavailable: true, issues: [String(e).slice(0, 160)] }))
    // A check cut off by the time limit says nothing about the story: store nothing, so it is checked at 7:00 AM.
    if (deadline.signal.aborted) return
    const record: StoredClaimCheck = { ...v, hash: contentHash(s), checkedAt: new Date().toISOString() }
    const { error } = await db.from('stories').update({ claim_check: record }).eq('id', s.id)
    if (error) log(`Could not store the claim check for "${s.headline.slice(0, 40)}": ${error.message}`)
    else stored++
  })
  clearTimeout(timer)
  log(`Claim checks stored for ${stored} of ${candidates.length} stories${deadline.signal.aborted ? ' (stopped at the time limit)' : ''}`)
  return { checked: candidates.length, stored }
}

/** The verifier for the draft run: no 30-second ceiling here, so it waits longer and retries more before giving up. */
export function draftClaimVerifier(): ClaimVerifier | undefined {
  const c = env()
  if (!c.aiKey) return undefined
  return aiClaimVerifier(openAiClient(c.aiKey, c.model, c.aiBaseUrl, { keySource: c.aiKeySource, reasoningEffort: c.reasoningEffort, timeoutSeconds: 60, retryDelaysMs: c.aiRetryDelays.length ? c.aiRetryDelays : [5_000, 20_000, 40_000] }))
}
