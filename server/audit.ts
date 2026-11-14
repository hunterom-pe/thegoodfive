/**
 * Production-readiness audit. Run:  npm run audit
 *
 * Reports what is configured and what is not, as names and yes/no only: it never prints a
 * secret value. Checks the live Supabase project READ-ONLY (it writes nothing), and the
 * deployed site's protected endpoints. Netlify's own dashboard cannot be inspected from
 * here, so the Netlify variables are listed for you to confirm by hand.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { SCHEDULE } from '../src/lib/schedule.ts'
import { admin, editionToday, env, supabasePublishStore } from './store.ts'

type Level = 'PASS' | 'WARN' | 'FAIL' | 'MANUAL'
const rows: { level: Level; area: string; text: string }[] = []
const note = (level: Level, area: string, text: string) => rows.push({ level, area, text })
const SITE = process.env.SITE_URL || 'https://thegoodfive.netlify.app'

// ── 1. Environment variable names ────────────────────────────────────────
const e = process.env
const set = (k: string) => Boolean((e[k] ?? '').trim())
const REQUIRED: [string, string][] = [
  ['VITE_SUPABASE_URL', 'public site: where to read editions'],
  ['VITE_SUPABASE_ANON_KEY', 'public site: read-only key (public by design)'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'server: drafts, publishing, run logs (SECRET)'],
  ['OPENAI_API_KEY', 'server: AI provider key, any OpenAI-compatible provider (SECRET)'],
  ['GENERATION_SECRET', 'server: lets scheduled functions start the background job (SECRET)'],
]
const OPTIONAL: [string, string][] = [
  ['OPENAI_BASE_URL', 'AI provider address (default: OpenAI)'],
  ['OPENAI_MODEL', 'AI model (default: gpt-4.1-mini)'],
  ['UNSPLASH_ACCESS_KEY', 'editor photo search only; never used by scheduled runs'],
  ['ALERT_WEBHOOK_URL', 'failure alerts (SECRET)'],
  ['EXTRA_TRUSTED_DOMAINS', 'extra publishers trusted for unattended publishing'],
  ['AUTO_PUBLISH_ENABLED', 'master switch: only the exact value "true" turns it on'],
  ['EDITION_TIMEZONE', 'default America/Phoenix'],
]
for (const [k, why] of REQUIRED) note(set(k) ? 'PASS' : 'FAIL', 'env', `${k} ${set(k) ? 'is set' : 'is MISSING'} (${why})`)
for (const [k, why] of OPTIONAL) note('PASS', 'env', `${k} ${set(k) ? 'is set' : 'not set'} (${why})`)
for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) if (!set(k) && !set(k.replace('VITE_', ''))) note('WARN', 'env', `${k} is not set in this shell`)
const flag = (e.AUTO_PUBLISH_ENABLED ?? '').trim().toLowerCase()
note(flag === 'true' ? 'WARN' : 'PASS', 'feature flag', flag === 'true' ? 'AUTO_PUBLISH_ENABLED is "true" here: automatic publishing is ON.' : 'Automatic publishing is OFF in this environment (the safe default).')
for (const k of Object.keys(e)) if (/^VITE_/.test(k) && /(SERVICE|SECRET|OPENAI|UNSPLASH|WEBHOOK)/i.test(k)) note('FAIL', 'secrets', `${k} is a VITE_ variable: it would be shipped to every visitor's browser.`)

// ── 2. Scheduled functions vs the dashboard's schedule ───────────────────
const dir = new URL('../netlify/functions/', import.meta.url)
const crons = readdirSync(dir).filter((f) => f.startsWith('daily-')).map((f) => ({ f, cron: /schedule: '([^']+)'/.exec(readFileSync(new URL(f, dir), 'utf8'))?.[1] }))
for (const job of SCHEDULE) note(crons.some((c) => c.cron === job.utcCron) ? 'PASS' : 'FAIL', 'schedule', `${job.label}: ${job.hour}:00 AM Phoenix = cron "${job.utcCron}" ${crons.some((c) => c.cron === job.utcCron) ? 'is deployed from netlify/functions' : 'has NO function'}`)

// ── 3. Live Supabase schema (read-only) ──────────────────────────────────
const c = env()
if (c.supabaseUrl && c.serviceKey) {
  const H = { apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}` }
  try {
    const res = await fetch(`${c.supabaseUrl}/rest/v1/`, { headers: H, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const api = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }>; paths?: Record<string, unknown> }
    const cols = (t: string) => Object.keys(api.definitions?.[t]?.properties ?? {})
    const has = (t: string, ...names: string[]) => names.every((n) => cols(t).includes(n))
    const rpc = (n: string) => Boolean(api.paths?.[`/rpc/${n}`])
    const mig = (name: string, ok: boolean, detail: string) => note(ok ? 'PASS' : 'FAIL', 'migration', `${name}: ${ok ? 'applied' : `NOT APPLIED (${detail})`}`)
    mig('20261113000000_init', has('editions', 'edition_date', 'status') && has('public_stories', 'headline') && rpc('set_lineup') && rpc('set_edition_status'), 'tables, views or functions missing')
    mig('20261113000100_editorial_controls', rpc('create_edition') && rpc('add_story') && rpc('delete_story'), 'create_edition/add_story/delete_story missing')
    mig('20261113000200_generated_drafts', has('discovery_runs', 'status', 'edition_date'), 'discovery_runs missing')
    mig('20261114000000_image_provenance', has('stories', 'image_kind', 'image_source', 'image_candidates') && has('public_stories', 'image_kind', 'image_credit_url'), 'story image columns or public view columns missing')
    mig('20261115000000_auto_publish', cols('publish_runs').length > 0 && has('stories', 'source_material', 'image_editor_approved') && rpc('set_story_image'), 'publish_runs table, story columns or set_story_image missing: RUN THIS MIGRATION')
    note(rpc('auto_publish_edition') ? 'PASS' : 'FAIL', 'security', rpc('auto_publish_edition') ? 'auto_publish_edition is installed (the service role may run it; the next checks prove nobody else can).' : 'auto_publish_edition is not installed.')

    // The exact queries the 7:00 AM publisher runs, read-only, against the real project.
    try {
      const store = supabasePublishStore(admin())
      const today = editionToday()
      const edition = await store.loadEdition(today)
      const recent = await store.recentSourceUrls(today)
      note('PASS', 'live queries', `The publisher's read queries work against the live database (today's edition: ${edition ? `${edition.status}, ${edition.stories.length} stories` : 'none yet'}; ${recent.length} recent article links).`)
    } catch (err) {
      note('FAIL', 'live queries', `The publisher's read queries failed: ${err instanceof Error ? err.message : err}`)
    }
    // Anonymous visitors must see published editions only.
    if (c.supabaseUrl && e.VITE_SUPABASE_ANON_KEY) {
      const A = { apikey: e.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${e.VITE_SUPABASE_ANON_KEY}` }
      for (const t of ['stories', 'editions', 'publish_runs', 'discovery_runs', 'editors']) {
        const r = await fetch(`${c.supabaseUrl}/rest/v1/${t}?select=*&limit=1`, { headers: A })
        note(r.status === 401 || r.status === 403 || r.status === 404 ? 'PASS' : 'FAIL', 'security', `Anonymous read of "${t}": ${r.status === 401 || r.status === 403 || r.status === 404 ? 'denied' : `ALLOWED (HTTP ${r.status})`}`)
      }
      // Privileged functions must refuse an anonymous caller. The arguments are deliberately dummy values that
      // would be rejected as "not found" even if the call were allowed, so this probe can never change anything.
      const ZERO = '00000000-0000-0000-0000-000000000000'
      const probes: [string, Record<string, unknown>][] = [
        ['auto_publish_edition', { p_edition: ZERO, p_date: '2000-01-01', p_primary: [ZERO, ZERO, ZERO, ZERO, ZERO], p_rejections: [] }],
        ['create_draft_edition', { p_date: '2000-01-01', p_stories: [] }],
        ['set_edition_status', { p_edition: ZERO, p_status: 'published' }],
        ['set_story_image', { p_story: ZERO, p_image: {} }],
        ['create_edition', { p_date: '2000-01-01' }],
      ]
      for (const [fn, body] of probes) {
        const r = await fetch(`${c.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...A, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const text = (await r.text()).slice(0, 200)
        const denied = r.status === 401 || r.status === 403 || /permission denied|not authori[sz]ed/i.test(text)
        note(denied ? 'PASS' : 'FAIL', 'security', `Anonymous call to ${fn}(): ${denied ? 'refused' : `NOT REFUSED (HTTP ${r.status})`}`)
      }
      const pv = await fetch(`${c.supabaseUrl}/rest/v1/public_stories?select=*&limit=1`, { headers: A })
      note(pv.ok ? 'PASS' : 'FAIL', 'security', `Public view "public_stories" readable by visitors: ${pv.ok ? 'yes (intended)' : `no (HTTP ${pv.status})`}`)
    }
  } catch (err) {
    note('FAIL', 'supabase', `Could not inspect the live Supabase project: ${err instanceof Error ? err.message : err}`)
  }
} else note('FAIL', 'supabase', 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: cannot inspect the live project.')

// ── 4. Provider keys (status only) ───────────────────────────────────────
if (c.openAiKey) {
  try {
    const r = await fetch(`${c.aiBaseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${c.openAiKey}` }, signal: AbortSignal.timeout(15_000) })
    note(r.ok ? 'PASS' : 'FAIL', 'ai', `AI provider (${new URL(c.aiBaseUrl).host}) accepts the key: ${r.ok ? 'yes' : `no (HTTP ${r.status})`}; model "${c.model}"`)
  } catch {
    note('WARN', 'ai', 'Could not reach the AI provider to check the key.')
  }
}
if (c.unsplashKey) {
  try {
    const r = await fetch('https://api.unsplash.com/search/photos?query=forest&per_page=1', { headers: { Authorization: `Client-ID ${c.unsplashKey}`, 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(15_000) })
    note(r.ok ? 'PASS' : 'FAIL', 'photos', `Unsplash accepts the access key: ${r.ok ? `yes (${r.headers.get('x-ratelimit-remaining') ?? '?'} requests left this hour)` : `no (HTTP ${r.status})`}`)
  } catch {
    note('WARN', 'photos', 'Could not reach Unsplash to check the key.')
  }
} else note('PASS', 'photos', 'No Unsplash key here: scheduled editions use the geometric artwork, which is the intended unattended behaviour.')

// ── 5. The deployed site's protected endpoints ───────────────────────────
for (const fn of ['editor-generate', 'editor-automation', 'editor-photos', 'editor-image-download']) {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) })
    note(r.status === 401 ? 'PASS' : 'FAIL', 'deployed', `${fn} without a login: HTTP ${r.status}${r.status === 401 ? ' (refused, as it should be)' : r.status === 404 ? ' (not deployed)' : ' (UNEXPECTED)'}`)
  } catch {
    note('WARN', 'deployed', `${fn}: could not reach ${SITE}`)
  }
}
const bg = await fetch(`${SITE}/.netlify/functions/generate-draft-background`, { method: 'POST', body: '{}' }).catch(() => null)
note(bg && bg.status !== 404 ? 'PASS' : 'FAIL', 'deployed', `generate-draft-background: ${bg ? `HTTP ${bg.status} (it ignores calls without the secret)` : 'unreachable'}`)

// ── 6. Secrets handling ──────────────────────────────────────────────────
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'GENERATION_SECRET', 'UNSPLASH_ACCESS_KEY', 'ALERT_WEBHOOK_URL'].filter((k) => set(k))
let leaked = 0
for (const k of secrets) for (const f of tracked) { try { if (readFileSync(f, 'utf8').includes(e[k]!)) { leaked++; note('FAIL', 'secrets', `The value of ${k} appears in tracked file ${f}!`) } } catch { /* binary or missing */ } }
note(leaked === 0 ? 'PASS' : 'FAIL', 'secrets', `Checked ${secrets.length} secret value(s) against ${tracked.length} tracked files: ${leaked === 0 ? 'none found' : `${leaked} leak(s)`}`)
note(tracked.some((f) => /(^|\/)\.env($|\.local)/.test(f)) ? 'FAIL' : 'PASS', 'secrets', 'No .env file is tracked by git.')

// ── 7. What only you can check ───────────────────────────────────────────
for (const t of [
  'Netlify → Site configuration → Environment variables: confirm every REQUIRED name above is present, and that the secret ones are marked "Contains secret values".',
  'Netlify → Functions: confirm the four daily-* scheduled functions are listed (they only run on a successful production deploy).',
  'Netlify → Environment variables: AUTO_PUBLISH_ENABLED should be absent or "false" until you decide to switch it on.',
  'Supabase → Authentication → Providers → Email: public sign-ups should be disabled (only your editor account is needed).',
  'Supabase → SQL Editor: confirm your user is in public.editors (select * from public.editors).',
]) note('MANUAL', 'dashboards', t)

const order: Level[] = ['FAIL', 'WARN', 'MANUAL', 'PASS']
for (const lvl of order) for (const r of rows.filter((x) => x.level === lvl)) console.log(`${lvl.padEnd(6)} [${r.area}] ${r.text}`)
console.log(`\n${rows.filter((r) => r.level === 'PASS').length} passed · ${rows.filter((r) => r.level === 'WARN').length} warnings · ${rows.filter((r) => r.level === 'FAIL').length} failed · ${rows.filter((r) => r.level === 'MANUAL').length} to check by hand`)
process.exit(rows.some((r) => r.level === 'FAIL') ? 1 : 0)
