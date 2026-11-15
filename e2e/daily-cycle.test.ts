import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { executeRun, editionToday, startRun } from '../server/store'
import { scheduledDraft, scheduledPublish } from '../server/scheduled'
import { contentHash } from '../server/autopublish'
import { localDb, postgresAvailable, startPg, type PgInstance } from './localdb'
import { World } from './world'

const TODAY = editionToday()
const YESTERDAY = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

const ENV = {
  SUPABASE_URL: 'https://e2e.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key', OPENAI_API_KEY: 'e2e-ai-key', OPENAI_BASE_URL: 'https://api.fake-llm.test/v1', OPENAI_MODEL: 'fake-model',
  GENERATION_SECRET: 'e2e-secret', URL: 'https://e2e.site', AUTO_PUBLISH_ENABLED: 'true', ALERT_WEBHOOK_URL: 'https://hooks.example.com/alert', AI_RETRY_DELAYS_MS: '1,1,1', GDELT_PAUSE_MS: '1', EDITION_TIMEZONE: 'America/Phoenix',
  // Present on purpose: unattended runs must IGNORE it (Unsplash's terms ask for non-automated use).
  UNSPLASH_ACCESS_KEY: 'e2e-unsplash-key',
} as Record<string, string>

describe.skipIf(!postgresAvailable())('the daily cycle, end to end (isolated database, fixture internet)', () => {
  const world = new World()
  let pg: PgInstance
  let db: ReturnType<typeof localDb>
  const saved: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v }
    pg = startPg()
    db = localDb(pg)
    world.install()
    // This stands in for Netlify: it checks the shared secret, then runs the real background job.
    world.background = async ({ secret, body }) => {
      if (secret !== process.env.GENERATION_SECRET) return 403
      void executeRun(db, body.runId!, body.date!, () => {})
      return 202
    }
  })
  afterAll(() => {
    world.restore()
    pg?.stop()
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })
  beforeEach(() => {
    pg.exec('truncate public.stories, public.editions, public.discovery_runs, public.publish_runs restart identity cascade')
    world.reset()
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v
    delete process.env.AI_TIMEOUT_SECONDS
    delete process.env.RUN_DEADLINE_MS
  })

  // ── helpers ──────────────────────────────────────────────────────────
  /** An earlier, already-published edition: what readers must keep seeing if today's cannot publish. */
  function seedPublished(date: string, tag = 'previous') {
    pg.exec(`insert into public.editions (edition_date, status) values ('${date}', 'draft');`)
    for (let n = 1; n <= 5; n++)
      pg.exec(`insert into public.stories (edition_id, role, position, category, headline, summary, source_name, source_url, source_published_at) select id, 'primary', ${n}, 'nature', '${tag} story ${n}', 'Summary ${n}', 'BBC News', 'https://www.bbc.co.uk/news/articles/${tag}-${n}', now() - interval '3 days' from public.editions where edition_date = '${date}';`)
    pg.exec(`update public.editions set status = 'published', published_at = now() - interval '1 day' where edition_date = '${date}';`)
  }
  const publicDates = () => (pg.query('select edition_date::text as d from public.public_editions order by edition_date desc', 'anon') as { d: string }[]).map((r) => r.d)
  const publicHeadlines = (date: string) => (pg.query(`select s.headline, s.position from public.public_stories s join public.public_editions e on e.id = s.edition_id where e.edition_date = '${date}' order by s.position`, 'anon') as { headline: string; position: number }[])
  const todayRow = () => (pg.query(`select id, status, published_by is null as automatic, published_at is not null as stamped from public.editions where edition_date = '${TODAY}'`)[0] as { id: string; status: string; automatic: boolean; stamped: boolean } | undefined)
  const storiesOf = (role: string) => pg.query(`select s.headline, s.summary, s.source_url, s.position, s.rejected_reason, length(s.source_material) as material, s.image_source, jsonb_array_length(s.image_candidates) as candidates from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}' and s.role = '${role}' order by s.position nulls last`) as { headline: string; summary: string; source_url: string; position: number | null; rejected_reason: string | null; material: number; image_source: string | null; candidates: number }[]
  const lastRun = (table: 'discovery_runs' | 'publish_runs') => pg.query(`select * from public.${table} where edition_date = '${TODAY}' order by started_at desc limit 1`)[0] as Record<string, unknown> | undefined
  async function waitForGeneration() {
    for (let i = 0; i < 300; i++) {
      const r = lastRun('discovery_runs')
      if (r && r.status !== 'running') return r
      await new Promise((res) => setTimeout(res, 100))
    }
    throw new Error('generation did not finish')
  }
  const previousStillVisible = () => {
    expect(publicDates()).toContain(YESTERDAY)
    expect(publicHeadlines(YESTERDAY).map((s) => s.headline)).toEqual([1, 2, 3, 4, 5].map((n) => `previous story ${n}`))
  }

  // ── the happy path ───────────────────────────────────────────────────
  it('runs the whole cycle with nobody logged in: discover → write → verify → publish → public site → archive', async () => {
    seedPublished(YESTERDAY)
    expect(publicDates()).toEqual([YESTERDAY])

    // 4:00 AM: the scheduled function starts a run, which goes through the (simulated) background function.
    await scheduledDraft('schedule', { db })
    const generation = await waitForGeneration()
    expect(generation.status, String(generation.error)).toBe('succeeded')
    expect((generation.stats as Record<string, number>).primary).toBe(5)

    // The draft exists, is NOT public, and holds five stories plus backups, each with its source text.
    expect(todayRow()).toMatchObject({ status: 'draft', stamped: false })
    expect(publicDates()).toEqual([YESTERDAY])
    const primaries = storiesOf('primary')
    expect(primaries).toHaveLength(5)
    expect(storiesOf('backup').length).toBeGreaterThanOrEqual(1)
    for (const s of primaries) {
      expect(s.material).toBeGreaterThanOrEqual(450)
      expect(s.source_url).toMatch(/^https:\/\/(www\.bbc\.co\.uk|www\.theguardian\.com|news\.mongabay\.com|www\.sciencedaily\.com)\//)
      expect(s.image_source).not.toBe('unsplash') // unattended: no Unsplash photo
      expect(s.candidates).toBe(1) // the article's own image is only a candidate
    }
    // The news the pipeline screened out (negative stories) never reached the draft.
    expect(primaries.map((s) => s.headline).join(' ')).not.toMatch(/Bombing|Shooting|dead|Tragedy/i)
    // Unsplash's terms ask for non-automated use: an unattended run must not call it, even with a key present.
    expect(world.calls('api.unsplash.com')).toBe(0)
    expect(world.calls('api.fake-llm.test')).toBe(2) // exactly two AI calls: cost stays low

    // 7:00 AM: the scheduled publisher verifies and publishes.
    const outcome = await scheduledPublish('schedule', { db })
    expect(outcome?.status, outcome?.reason).toBe('published')
    expect(todayRow()).toMatchObject({ status: 'published', automatic: true, stamped: true })

    // The public site's data: today first, then the previous edition; five stories in order; exactly what was drafted.
    expect(publicDates()).toEqual([TODAY, YESTERDAY])
    expect(publicHeadlines(TODAY).map((s) => s.headline)).toEqual(primaries.map((s) => s.headline))
    expect(publicHeadlines(TODAY).map((s) => s.position)).toEqual([1, 2, 3, 4, 5])
    // The unattended edition shows artwork, not an unapproved publisher image.
    expect(pg.query(`select image_url from public.public_stories where image_url is not null`, 'anon')).toEqual([])
    // Editorial data stays private.
    expect(() => pg.query('select source_material from public.stories', 'anon')).toThrow()
    expect(lastRun('publish_runs')).toMatchObject({ status: 'published', trigger: 'schedule' })
    expect(world.blocked, 'nothing outside the fixtures was contacted').toEqual([])

    // The 8:00 AM retry, and a second scheduled run, change nothing.
    const stamp = (pg.query(`select published_at from public.editions where edition_date = '${TODAY}'`)[0] as { published_at: string }).published_at
    const retry = await scheduledPublish('retry', { db })
    expect(retry?.status).toBe('skipped')
    expect((pg.query(`select published_at from public.editions where edition_date = '${TODAY}'`)[0] as { published_at: string }).published_at).toBe(stamp)
    expect(pg.query(`select 1 from public.editions where status = 'published' and edition_date = '${TODAY}'`)).toHaveLength(1)
    // The photo library is empty in this scenario, so the one message sent says so; nothing else went wrong.
    expect(world.alerts).toHaveLength(1)
    expect(world.alerts[0]).toMatch(/5 of 5 stories without an approved photo/)
  })

  // ── feature flag and manual control ──────────────────────────────────
  it('does nothing at 7:00 AM while AUTO_PUBLISH_ENABLED is off, and says so', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    process.env.AUTO_PUBLISH_ENABLED = 'false'
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('disabled')
    expect(todayRow()?.status).toBe('draft')
    expect(publicDates()).toEqual([YESTERDAY])
    expect(lastRun('publish_runs')).toMatchObject({ status: 'disabled' })
  })

  it('an editor holding the edition ("In review") stops the robot', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    pg.exec(`update public.editions set status = 'review' where edition_date = '${TODAY}'`)
    expect((await scheduledPublish('schedule', { db }))?.status).toBe('skipped')
    expect(todayRow()?.status).toBe('review')
    previousStillVisible()
  })

  it('a published edition for today is never touched, and no AI money is spent regenerating it', async () => {
    seedPublished(TODAY, 'today')
    const before = todayRow()
    await scheduledDraft('schedule', { db })
    expect(world.calls('api.fake-llm.test')).toBe(0)
    expect((await scheduledPublish('schedule', { db }))?.status).toBe('skipped')
    expect(todayRow()).toEqual(before)
  })

  // ── failures: the previous edition must always remain ────────────────
  it('OpenAI failing: the run fails cleanly, retries a bounded number of times, alerts, and the previous edition stays', async () => {
    seedPublished(YESTERDAY)
    world.reset({ ai: 'error500' })
    await scheduledDraft('schedule', { db })
    const run = await waitForGeneration()
    expect(run.status).toBe('failed')
    expect(String(run.error)).toMatch(/AI provider error 500/)
    expect(world.calls('api.fake-llm.test')).toBe(4) // one attempt plus three bounded retries: spend is capped
    expect(world.alerts.join(' ')).toMatch(/Draft generation .* failed/)
    expect(todayRow()).toBeUndefined()
    previousStillVisible()
    // 7:00 AM then finds no draft: it publishes nothing and records why.
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('failed')
    expect(out?.reason).toMatch(/No draft was generated/)
    previousStillVisible()
  })

  it('OpenAI timing out is recorded as a failure, not a hang', async () => {
    seedPublished(YESTERDAY)
    world.reset({ ai: 'hang' })
    process.env.AI_TIMEOUT_SECONDS = '1'
    await scheduledDraft('schedule', { db })
    const run = await waitForGeneration()
    expect(run.status).toBe('failed')
    expect(String(run.error)).toMatch(/timeout|timed out|aborted/i)
    previousStillVisible()
  })

  it('news sources unreachable: no draft is invented, the run is recorded as skipped, you are alerted', async () => {
    seedPublished(YESTERDAY)
    world.reset({ feedsDown: true })
    await scheduledDraft('schedule', { db })
    const run = await waitForGeneration()
    expect(run.status).toBe('skipped')
    expect(String(run.error)).toMatch(/No suitable stories/)
    expect(world.calls('api.fake-llm.test')).toBe(0) // nothing to screen: no AI spend
    expect(world.alerts.join(' ')).toMatch(/no suitable stories/i)
    expect(todayRow()).toBeUndefined()
    previousStillVisible()
  })

  it('too few trustworthy stories: the draft records why each was turned away, and nothing is published', async () => {
    seedPublished(YESTERDAY)
    world.reset({ goodTrusted: 3, goodUntrusted: 5 })
    await scheduledDraft('schedule', { db })
    expect((await waitForGeneration()).status).toBe('succeeded')
    expect(storiesOf('primary')).toHaveLength(3)
    const rejected = storiesOf('rejected')
    expect(rejected.length).toBeGreaterThanOrEqual(1)
    expect(rejected.map((r) => r.rejected_reason).join(' ')).toMatch(/trusted-sources list/)
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('failed')
    expect(out?.reason).toMatch(/Only 3 of 5 stories passed verification/)
    expect(todayRow()?.status).toBe('draft')
    expect(world.alerts.join(' ')).toMatch(/Only 3 of 5/)
    expect(publicDates()).toEqual([YESTERDAY])
    previousStillVisible()
  })

  it('unsupported claims in the writing are caught against the source, and backups take their place', async () => {
    seedPublished(YESTERDAY)
    world.reset({ ai: 'invent' }) // the model "invents" a figure in two summaries
    await scheduledDraft('schedule', { db })
    expect((await waitForGeneration()).status).toBe('succeeded')
    const rejected = storiesOf('rejected')
    expect(rejected.length).toBe(2)
    expect(rejected.every((r) => /7,500|7500/.test(r.rejected_reason ?? ''))).toBe(true)
    expect(storiesOf('primary')).toHaveLength(5) // backups stepped up
    expect((await scheduledPublish('schedule', { db }))?.status).toBe('published')
    const headlines = publicHeadlines(TODAY)
    expect(headlines).toHaveLength(5)
    const text = JSON.stringify(pg.query('select summary from public.public_stories', 'anon'))
    expect(text).not.toMatch(/7,500/)
  })

  it('if the model invents claims everywhere, nothing publishes', async () => {
    seedPublished(YESTERDAY)
    world.reset({ ai: 'inventAll' })
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    expect(storiesOf('primary')).toHaveLength(0)
    expect((await scheduledPublish('schedule', { db }))?.status).toBe('failed')
    previousStillVisible()
  })

  it('a source article that disappears before 7:00 AM is rejected and replaced', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    const victim = storiesOf('primary')[1].source_url
    world.state.gone.add(victim)
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('published')
    expect(publicHeadlines(TODAY)).toHaveLength(5)
    expect(JSON.stringify(out?.record.details.rejected)).toMatch(/article is gone/)
    expect(pg.query(`select 1 from public.public_stories where source_url = '${victim}'`, 'anon')).toHaveLength(0)
  })

  it('an image that cannot load never blocks publication (readers see the artwork)', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    // An editor approved a photo whose address is now dead.
    pg.exec(`update public.stories set image_url = 'https://dead-photos.example/gone.jpg', image_kind = 'original', image_source = 'manual', image_rights_confirmed = true, image_editor_approved = true where id = (select s.id from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}' and s.role = 'primary' and s.position = 2)`)
    expect((await scheduledPublish('schedule', { db }))?.status).toBe('published')
    expect(world.calls('dead-photos.example')).toBe(0) // the server never fetches images
    expect(pg.query(`select image_url from public.public_stories where image_url is not null`, 'anon')).toHaveLength(1)
  })

  it('an image provider outage during an editor-started run does not stop the draft', async () => {
    seedPublished(YESTERDAY)
    world.reset({ unsplash: 'down' })
    const run = await startRun(db, TODAY, 'manual')
    expect(run.ok).toBe(true)
    if (run.ok) await executeRun(db, run.runId, TODAY, () => {})
    expect(lastRun('discovery_runs')?.status).toBe('succeeded')
    expect(world.calls('api.unsplash.com')).toBeGreaterThan(0) // a person started it, so photos were attempted
    expect(storiesOf('primary')).toHaveLength(5)
    expect(storiesOf('primary').every((s) => s.image_source !== 'unsplash')).toBe(true)
    expect(storiesOf('primary')[0].candidates).toBe(1) // still has the article's image as a candidate
  })

  it('Supabase failing at 7:00 AM: the job reports it, publishes nothing, and the 8:00 AM retry succeeds', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    let down = true
    const flaky = localDb(pg, { onCall: () => (down ? { message: 'upstream connect error (503)' } : undefined) })
    const first = await scheduledPublish('schedule', { db: flaky })
    expect(first?.status).toBe('failed')
    expect(first?.reason).toMatch(/upstream connect error/)
    expect(world.alerts.join(' ')).toMatch(/Automatic publishing failed/)
    expect(world.alerts.join(' ')).toMatch(/retry runs at 8:00/)
    expect(todayRow()?.status).toBe('draft')
    previousStillVisible()
    down = false
    const retry = await scheduledPublish('retry', { db: flaky })
    expect(retry?.status).toBe('published')
    expect(publicDates()).toEqual([TODAY, YESTERDAY])
  })

  it('Supabase failing at 4:00 AM is reported rather than thrown, and the 5:00 AM retry recovers', async () => {
    seedPublished(YESTERDAY)
    let down = true
    const flaky = localDb(pg, { onCall: () => (down ? { message: 'upstream connect error (503)' } : undefined) })
    await expect(scheduledDraft('schedule', { db: flaky })).resolves.toBeUndefined()
    expect(world.alerts.join(' ')).toMatch(/could not start/)
    expect(world.calls('api.fake-llm.test')).toBe(0)
    down = false
    await scheduledDraft('retry', { db: flaky })
    expect((await waitForGeneration()).status).toBe('succeeded')
    previousStillVisible()
  })

  it('two publishers at once: exactly one publishes', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    const [a, b] = await Promise.all([scheduledPublish('schedule', { db }), scheduledPublish('retry', { db })])
    expect([a?.status, b?.status].sort()).toEqual(['published', 'skipped'])
    expect(pg.query(`select 1 from public.editions where status = 'published' and edition_date = '${TODAY}'`)).toHaveLength(1)
  })

  // ── claim verification before publishing ─────────────────────────────
  it('if the claim check is unavailable at 7:00 AM, the edition is held for an editor and nothing is published', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    world.reset({ claimCheck: 'down' })
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('failed')
    expect(out?.reason).toMatch(/Held for an editor/)
    expect(todayRow()).toMatchObject({ status: 'draft' })
    expect(publicDates()).toEqual([YESTERDAY])
    expect(world.alerts.join(' ')).toMatch(/Held for an editor/)
  })

  it('a story the claim check cannot confirm is replaced by a confirmed backup, and the edition still publishes', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    const drafted = (storiesOf('primary') as { headline: string }[]).map((s) => s.headline)
    world.reset({ claimCheck: 'unsure' })
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status, out?.reason).toBe('published')
    const live = publicHeadlines(TODAY).map((s) => s.headline)
    expect(live).toHaveLength(5)
    if (drafted.some((h) => /turtle/i.test(h))) expect(live.join(' ')).not.toMatch(/turtle/i)
    expect(out?.record.details.needsReview?.length ?? 0).toBeGreaterThan(0)
  })

  it('if every story’s claims conflict with its source, nothing is published', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    world.reset({ claimCheck: 'conflict' })
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('failed')
    expect(todayRow()).toMatchObject({ status: 'draft' })
    expect(publicDates()).toEqual([YESTERDAY])
  })

  // ── photos from the editor's library ─────────────────────────────────
  it('a scheduled edition uses editor-approved library photos: no Unsplash search, credited, and published', async () => {
    seedPublished(YESTERDAY)
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
    pg.query(`insert into public.photo_library (id, unsplash_id, url, alt, credit, credit_url, source_url, download_location, categories, keywords, generic)
      values ('${id(1)}', 'nat1', 'https://images.unsplash.com/photo-nat1?ixid=abc', 'A calm river in morning light', 'Ada Lens', 'https://unsplash.com/@ada', 'https://unsplash.com/photos/nat1', 'https://api.unsplash.com/photos/nat1/download?ixid=abc', '{nature}', '{river,salmon,turtle,bees}', true),
             ('${id(2)}', 'hum1', 'https://images.unsplash.com/photo-hum1?ixid=abc', 'A village hall in sunshine', 'Bo Frame', 'https://unsplash.com/@bo', 'https://unsplash.com/photos/hum1', 'https://api.unsplash.com/photos/hum1/download?ixid=abc', '{humanity}', '{village,library,community}', true) returning id`)
    await scheduledDraft('schedule', { db })
    const generation = await waitForGeneration()
    expect(generation.status, String(generation.error)).toBe('succeeded')
    const withLibrary = pg.query(`select image_source, image_kind, image_rights_confirmed, image_editor_approved, image_credit from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}' and s.role = 'primary' and s.image_source = 'unsplash'`) as { image_kind: string; image_rights_confirmed: boolean; image_editor_approved: boolean; image_credit: string }[]
    expect(withLibrary.length).toBeGreaterThan(0)
    for (const s of withLibrary) expect(s).toMatchObject({ image_kind: 'illustrative', image_rights_confirmed: true, image_editor_approved: true })
    // Unsplash was only ever told a photo was used. It was never searched.
    expect(world.log.filter((u) => u.includes('api.unsplash.com') && u.includes('/search/'))).toEqual([])
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status, out?.reason).toBe('published')
    const shown = pg.query(`select image_credit, image_kind from public.public_stories where image_url is not null`, 'anon') as { image_credit: string; image_kind: string }[]
    expect(shown.length).toBe(withLibrary.length)
    for (const s of shown) expect(s.image_kind).toBe('illustrative')
    expect(pg.query(`select use_count from public.photo_library where use_count > 0`).length).toBeGreaterThan(0)
  })

  it('with the starter library installed, every story gets a credited photo and the published edition shows five photos', async () => {
    seedPublished(YESTERDAY)
    // The real starter library, then its curation, exactly as a person would run them.
    pg.exec(readFileSync(join(process.cwd(), 'supabase/seeds/photo_library_seed.sql'), 'utf8'))
    pg.exec(readFileSync(join(process.cwd(), 'supabase/seeds/photo_library_curation.sql'), 'utf8'))
    await scheduledDraft('schedule', { db })
    const generation = await waitForGeneration()
    expect(generation.status, String(generation.error)).toBe('succeeded')
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status, out?.reason).toBe('published')
    // Relevance, not just coverage: each photo must fit its story, and a mismatched picture is worse than none.
    const given = pg.query(`select s.headline, coalesce(s.image_alt, '') as alt from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}' and s.role = 'primary'`) as { headline: string; alt: string }[]
    const altFor = (re: RegExp) => given.find((g) => re.test(g.headline))?.alt ?? ''
    expect(altFor(/library van/i)).toMatch(/books|library/i)
    expect(altFor(/salmon/i)).toMatch(/river/i)
    for (const g of given) expect(g.alt, g.headline).not.toMatch(/coral|textile|vegetable|pill|heart|floral/i)
    const shown = pg.query(`select image_url, image_credit, image_kind from public.public_stories where image_url is not null`, 'anon') as { image_credit: string; image_kind: string }[]
    expect(shown).toHaveLength(5)
    for (const s of shown) expect(s).toMatchObject({ image_kind: 'illustrative' })
    for (const s of shown) expect(s.image_credit).toBeTruthy()
    expect(out?.record.details.warnings?.join(' ') ?? '').not.toMatch(/no approved photo/)
    expect(world.log.filter((u) => u.includes('api.unsplash.com') && u.includes('/search/'))).toEqual([])
  })

  // ── round 2: integrity ───────────────────────────────────────────────
  const tomorrow = () => new Date(Date.parse(`${TODAY}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

  it('the database fingerprint matches the application’s, byte for byte', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    const rows = pg.query(`select s.id, s.headline, s.summary, s.category::text as category, s.source_name, s.source_url, s.source_material, s.source_published_at, s.ai_rationale, public.story_content_hash_v2(s) as db_hash from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}'`) as { headline: string; summary: string; category: string; source_name: string; source_url: string; source_material: string | null; source_published_at: string | null; ai_rationale: string | null; db_hash: string }[]
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const r of rows) expect(contentHash({ headline: r.headline, summary: r.summary, category: r.category, sourceName: r.source_name, sourceUrl: r.source_url, sourceMaterial: r.source_material, sourcePublishedAt: r.source_published_at, aiRationale: r.ai_rationale })).toBe(r.db_hash)
    // Timestamps with fractional seconds and offsets agree too.
    pg.exec(`update public.stories set source_published_at = '2026-11-13 21:00:00.123456-07' where id = (select s.id from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}' limit 1)`)
    const r = pg.query(`select s.headline, s.summary, s.category::text as category, s.source_name, s.source_url, s.source_material, s.source_published_at, s.ai_rationale, public.story_content_hash_v2(s) as db_hash from public.stories s where source_published_at = '2026-11-13 21:00:00.123456-07'`)[0] as (typeof rows)[number]
    expect(contentHash({ headline: r.headline, summary: r.summary, category: r.category, sourceName: r.source_name, sourceUrl: r.source_url, sourceMaterial: r.source_material, sourcePublishedAt: r.source_published_at, aiRationale: r.ai_rationale })).toBe(r.db_hash)
  })

  it('a story edited while the claim check is running is not published, and the edition stays a draft', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    let edited = false
    world.onClaimCheck = () => {
      if (edited) return
      edited = true // an editor saves a change after the application read the draft but before it publishes
      pg.exec(`update public.stories set summary = summary || ' An editor added a sentence.' where id = (select s.id from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}' and s.role = 'primary' and s.position = 3)`)
    }
    const out = await scheduledPublish('schedule', { db })
    world.onClaimCheck = undefined
    expect(out?.status).toBe('skipped')
    expect(out?.reason).toMatch(/edited after it was checked/)
    expect(todayRow()?.status).toBe('draft')
    expect(publicDates()).toEqual([YESTERDAY])
    expect(world.alerts.join(' ')).toMatch(/edited after it was checked/)
    // The next run reads the edited text, checks it, and decides for itself: nothing unchecked ever goes out.
    const retry = await scheduledPublish('retry', { db })
    if (retry?.status === 'published') expect(publicHeadlines(TODAY)).toHaveLength(5)
    else expect(todayRow()?.status).toBe('draft')
  })

  it('moving a source date while the claim check runs stops publication', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    let edited = false
    world.onClaimCheck = () => {
      if (edited) return
      edited = true // still within the database's 7-day rule, but past the 5-day freshness check
      pg.exec(`update public.stories set source_published_at = now() - interval '6 days' where id = (select s.id from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${TODAY}' and s.role = 'primary' and s.position = 2)`)
    }
    const out = await scheduledPublish('schedule', { db })
    world.onClaimCheck = undefined
    expect(out?.status).toBe('skipped')
    expect(out?.reason).toMatch(/edited after it was checked/)
    expect(todayRow()?.status).toBe('draft')
  })

  it('the publish function itself refuses stale or missing fingerprints, whatever the caller says', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    const ed = pg.query(`select id from public.editions where edition_date = '${TODAY}'`)[0] as { id: string }
    const five = pg.query(`select s.id, public.story_content_hash_v2(s) as hash, public.story_content_hash(s) as hash_v1 from public.stories s where s.edition_id = '${ed.id}' and s.role = 'primary' order by s.position`) as { id: string; hash: string; hash_v1: string }[]
    const call = (checked: unknown) => db.rpc('auto_publish_edition', { p_edition: ed.id, p_date: TODAY, p_primary: five.map((f) => f.id), p_rejections: [], p_checked: checked })
    const stale = await call(five.map((f, i) => ({ id: f.id, hash: i === 1 ? 'deadbeef' : f.hash, v: 2 })))
    expect(stale).toMatchObject({ data: 'changed', error: null })
    expect((await call(five.slice(0, 4))).error?.message).toMatch(/checked content of all five/)
    expect((await call(five.map((f) => ({ id: f.id, hash: null })))).data).toBe('changed')
    expect(todayRow()?.status).toBe('draft') // nothing moved
    expect(publicDates()).toEqual([YESTERDAY])
    expect((await call(five.map((f) => ({ id: f.id, hash: f.hash, v: 3 })))).data).toBe('changed') // an unknown version never matches
    expect((await call(five.map((f) => ({ id: f.id, hash: f.hash_v1, v: 2 })))).data).toBe('changed') // a v1 value claimed as v2
    // Version 1 is still accepted during the changeover, so the database can be updated before or after the code.
    const good = await call(five.map((f) => ({ id: f.id, hash: f.hash_v1 })))
    expect(good).toMatchObject({ data: 'published', error: null })
  })

  it('an approved edition dated in the future is invisible to the public API until its day', async () => {
    seedPublished(YESTERDAY)
    seedPublished(TODAY, 'today')
    seedPublished(tomorrow(), 'future')
    expect(publicDates()).toEqual([TODAY, YESTERDAY]) // not tomorrow
    expect(publicHeadlines(tomorrow())).toEqual([])
    expect(pg.query(`select 1 from public.public_stories where headline like 'future story%'`, 'anon')).toHaveLength(0)
    expect(pg.query(`select 1 from public.public_stories where headline like 'today story%'`, 'anon')).toHaveLength(5)
    // The editor's own tables still hold it: it is approved, only hidden from readers.
    expect(pg.query(`select status from public.editions where edition_date = '${tomorrow()}'`)[0]).toMatchObject({ status: 'published' })
    // And a direct story query by id cannot reach it either.
    const id = (pg.query(`select s.id from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${tomorrow()}' limit 1`)[0] as { id: string }).id
    expect(pg.query(`select 1 from public.public_stories where id = '${id}'`, 'anon')).toHaveLength(0)
  })

  it('if the run budget cannot be read, no run starts and nothing is spent on AI; the failure is alerted', async () => {
    seedPublished(YESTERDAY)
    const broken = localDb(pg, { onCall: (kind, name) => (kind === 'select' && name === 'discovery_runs' ? { message: 'upstream connect error (503)' } : undefined) })
    await scheduledDraft('schedule', { db: broken })
    expect(world.calls('api.fake-llm.test')).toBe(0)
    expect(pg.query(`select 1 from public.discovery_runs`)).toHaveLength(0)
    expect(world.alerts.join(' ')).toMatch(/run budget/)
  })

  it('if the existing edition cannot be checked, no run starts', async () => {
    seedPublished(YESTERDAY)
    const broken = localDb(pg, { onCall: (kind, name) => (kind === 'select' && name === 'editions' ? { message: 'permission denied' } : undefined) })
    await scheduledDraft('schedule', { db: broken })
    expect(world.calls('api.fake-llm.test')).toBe(0)
    expect(pg.query(`select 1 from public.discovery_runs`)).toHaveLength(0)
    expect(world.alerts.join(' ')).toMatch(/existing edition/)
  })

  it('if the publish outcome cannot be saved, the edition still publishes and an alert says the record is missing', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    const noLog = localDb(pg, { onCall: (kind, name) => (kind === 'insert' && name === 'publish_runs' ? { message: 'disk full' } : undefined) })
    const out = await scheduledPublish('schedule', { db: noLog })
    expect(out?.status).toBe('published')
    expect(world.alerts.join(' ')).toMatch(/record could not be saved.*disk full/)
    expect(pg.query(`select 1 from public.publish_runs`)).toHaveLength(0)
  })

  it('if a draft run’s outcome cannot be saved, the failure is alerted instead of swallowed', async () => {
    seedPublished(YESTERDAY)
    const noFinish = localDb(pg, { onCall: (kind, name) => (kind === 'update' && name === 'discovery_runs' && world.calls('api.fake-llm.test') > 0 ? { message: 'connection reset' } : undefined) })
    world.background = async ({ secret, body }) => {
      if (secret !== process.env.GENERATION_SECRET) return 403
      await executeRun(noFinish, body.runId!, body.date!, () => {})
      return 202
    }
    await scheduledDraft('schedule', { db })
    await new Promise((r) => setTimeout(r, 1500))
    expect(world.alerts.join(' ')).toMatch(/outcome could not be saved.*connection reset/)
    world.background = async ({ secret, body }) => {
      if (secret !== process.env.GENERATION_SECRET) return 403
      void executeRun(db, body.runId!, body.date!, () => {})
      return 202
    }
  })

  it('a failing alert webhook is recorded with the run, and the run still completes', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    world.reset({ claimCheck: 'down', webhook: 'http500' })
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('failed') // held: the claim check is down
    const rec = pg.query(`select status, details from public.publish_runs where edition_date = '${TODAY}' order by started_at desc limit 1`)[0] as { status: string; details: { alertFailures?: string[] } }
    expect(rec.status).toBe('failed')
    expect(rec.details.alertFailures?.[0]).toMatch(/HTTP 500/)
    expect(todayRow()?.status).toBe('draft')
  })

  it('an unreachable alert webhook never blocks a publication', async () => {
    seedPublished(YESTERDAY)
    await scheduledDraft('schedule', { db })
    await waitForGeneration()
    world.reset({ webhook: 'down' })
    const out = await scheduledPublish('schedule', { db })
    expect(out?.status).toBe('published')
    expect(publicDates()).toEqual([TODAY, YESTERDAY])
  })

  // ── generation taking too long ───────────────────────────────────────
  it('a run that takes too long is stopped, recorded as failed, and the previous edition stays', async () => {
    seedPublished(YESTERDAY)
    world.reset({ ai: 'hang' })
    process.env.RUN_DEADLINE_MS = '1500'
    process.env.AI_TIMEOUT_SECONDS = '60'
    const started = Date.now()
    await scheduledDraft('schedule', { db })
    const run = await waitForGeneration()
    expect(run.status).toBe('failed')
    expect(String(run.error)).toMatch(/took longer than/)
    expect(Date.now() - started).toBeLessThan(15_000)
    previousStillVisible()
  })

  it('a run that died without reporting does not block the next day, but a live run is respected', async () => {
    pg.exec(`insert into public.discovery_runs (edition_date, status, started_at) values ('${TODAY}', 'running', now() - interval '30 minutes')`)
    const recovered = await startRun(db, TODAY, 'schedule')
    expect(recovered.ok).toBe(true) // the stale one was marked failed
    expect(pg.query(`select 1 from public.discovery_runs where status = 'failed' and error like '%did not finish%'`)).toHaveLength(1)
    const concurrent = await startRun(db, TODAY, 'manual')
    expect(concurrent).toMatchObject({ ok: false, status: 409 })
  })

  it('caps repeated runs so a retry loop cannot run up an AI bill', async () => {
    process.env.MAX_RUNS_PER_DAY = '2'
    for (let i = 0; i < 2; i++) pg.exec(`insert into public.discovery_runs (edition_date, status) values ('${TODAY}', 'failed')`)
    const run = await startRun(db, TODAY, 'manual')
    expect(run).toMatchObject({ ok: false, status: 429 })
    delete process.env.MAX_RUNS_PER_DAY
  })

  it('the background job ignores a caller without the shared secret', async () => {
    const res = await fetch('https://e2e.site/.netlify/functions/generate-draft-background', { method: 'POST', headers: { 'x-generation-secret': 'wrong' }, body: JSON.stringify({ runId: 'x', date: TODAY }) })
    expect(res.status).toBe(403)
  })
})
