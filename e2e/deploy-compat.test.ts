import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { runAutoPublish, type SourceChecker } from '../server/autopublish'
import { editionToday, supabasePublishStore } from '../server/store'
import { fiveGood } from '../server/fixtures'
import type { ClaimVerifier } from '../server/pipeline/verify'
import { localDb, postgresAvailable, startPg, type PgInstance } from './localdb'

/**
 * The deployment compatibility matrix for fingerprint version 2 (migration 20261118000000):
 *   old code + old database, old code + migrated database, new code + migrated database: publish;
 *   new code + old database: refused (fails closed), which is why the migration must be applied first.
 * "Old database" is every migration except 20261118000000. "Old code" sends what commit 75fb325 sends:
 * a version-1 fingerprint with no version field. "New code" is this repository's real publisher.
 */
const V2_MIGRATION = '20261118000000_fingerprint_v2.sql'
/** Later migrations that redefine the publish function on top of version 2 belong to the migrated database only. */
const BUILT_ON_V2 = ['20261122000000_already_ran_means_published.sql']

interface Row {
  id: string
  headline: string
  summary: string
  category: string
  sourceName: string
  sourceUrl: string
  sourceMaterial: string | null
}

/** Exactly the fingerprint commit 75fb325 computed (round 2): no publication time, no assessment, no version. */
function oldCodeHash(s: Row): string {
  const md5 = (t: string) => createHash('md5').update(t, 'utf8').digest('hex')
  return md5([s.headline, s.summary, s.category, s.sourceName, s.sourceUrl, md5(s.sourceMaterial ?? '')].join('\x1f'))
}

const describeIf = postgresAvailable() ? describe : describe.skip

describeIf('deployment compatibility (fingerprint v2)', () => {
  let pg: PgInstance | undefined
  afterEach(() => {
    pg?.stop()
    pg = undefined
  })

  const date = editionToday()
  /** A SQL string literal (standard quoting: single quotes doubled). */
  const lit = (t: string) => `'${t.replace(/'/g, "''")}'`

  /** Today's draft: five valid stories, as the 4:00 AM run would leave them. */
  function seedDraft(db: PgInstance): Row[] {
    db.exec(`insert into public.editions (edition_date, status) values ('${date}', 'draft')`)
    fiveGood().forEach((s, i) =>
      db.exec(
        `insert into public.stories (edition_id, role, position, category, headline, summary, source_name, source_url, source_published_at, source_material, ai_rationale)
         select id, 'primary', ${i + 1}, ${lit(s.category)}, ${lit(s.headline)}, ${lit(s.summary)}, ${lit(s.sourceName)}, ${lit(s.sourceUrl)}, now() - interval '10 hours', ${lit(s.sourceMaterial ?? '')}, ${lit(s.aiRationale ?? '')}
         from public.editions where edition_date = '${date}'`,
      ),
    )
    return db.query(
      `select s.id, s.headline, s.summary, s.category::text as category, s.source_name as "sourceName", s.source_url as "sourceUrl", s.source_material as "sourceMaterial"
       from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '${date}' order by s.position`,
    ) as Row[]
  }
  const status = (db: PgInstance) => (db.query(`select status from public.editions where edition_date = '${date}'`)[0] as { status: string }).status

  async function oldCode(db: PgInstance) {
    const five = seedDraft(db)
    const ed = (db.query(`select id from public.editions where edition_date = '${date}'`)[0] as { id: string }).id
    return localDb(db).rpc('auto_publish_edition', { p_edition: ed, p_date: date, p_primary: five.map((s) => s.id), p_rejections: [], p_checked: five.map((s) => ({ id: s.id, hash: oldCodeHash(s) })) })
  }
  async function newCode(db: PgInstance) {
    seedDraft(db)
    const reachable: SourceChecker = async () => ({ ok: true })
    const confirmed: ClaimVerifier = async () => ({ verdict: 'verified', issues: [] })
    return runAutoPublish({ store: supabasePublishStore(localDb(db)), date, trigger: 'schedule', enabled: true, checkSource: reachable, verify: confirmed })
  }

  it('old code + old database: publishes', async () => {
    pg = startPg({ skipMigrations: [V2_MIGRATION, ...BUILT_ON_V2] })
    expect(await oldCode(pg)).toMatchObject({ data: 'published', error: null })
    expect(status(pg)).toBe('published')
  })

  it('old code + migrated database: still publishes (the migration keeps version 1 working)', async () => {
    pg = startPg()
    expect(await oldCode(pg)).toMatchObject({ data: 'published', error: null })
    expect(status(pg)).toBe('published')
  })

  it('new code + migrated database: publishes', async () => {
    pg = startPg()
    const out = await newCode(pg)
    expect(out.status, out.reason).toBe('published')
    expect(status(pg)).toBe('published')
  })

  it('new code + old database: EXPECTED FAILURE. Nothing publishes, the run says why, the draft is untouched', async () => {
    pg = startPg({ skipMigrations: [V2_MIGRATION, ...BUILT_ON_V2] })
    const out = await newCode(pg)
    expect(out.status).toBe('skipped')
    expect(out.reason).toMatch(/edited after it was checked/)
    expect(status(pg)).toBe('draft')
    // The refusal is recorded, so the dashboard shows it.
    expect(pg.query(`select status from public.publish_runs where edition_date = '${date}'`)).toEqual([{ status: 'skipped' }])
  })
})
