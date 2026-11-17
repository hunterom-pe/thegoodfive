import { describe, expect, it } from 'vitest'
import { story } from './fixtures'
import { storeDraftClaimChecks } from './store'
import { contentHash } from './autopublish'
import type { Verification } from './pipeline/verify'

// The draft-time pass that rewrites wording the claim check could not confirm, then checks the rewrite from scratch.
const recent = new Date(Date.now() - 6 * 3_600_000).toISOString()
const good = story(0, { sourcePublishedAt: recent })
const embellished = { ...good, summary: good.summary.replace('counted 1,140', 'successfully counted a crucial 1,140') }
const row = (s: typeof good) => ({ id: s.id, role: s.role, position: s.position, headline: s.headline, summary: s.summary, category: s.category, source_name: s.sourceName, source_url: s.sourceUrl, source_published_at: s.sourcePublishedAt, source_material: s.sourceMaterial, ai_rationale: s.aiRationale })

function fakeDb(stories: Record<string, unknown>[]) {
  const writes: { table: string; body: Record<string, unknown> }[] = []
  return {
    writes,
    db: {
      from(table: string) {
        let op = 'select'
        let body: Record<string, unknown> = {}
        const q: any = new Proxy({}, {
          get(_t, key) {
            if (key === 'then') return (resolve: any) => {
              if (op === 'update') writes.push({ table, body })
              const data = table === 'editions' ? { id: 'e1', edition_date: '2026-11-17', status: 'draft', stories } : []
              return Promise.resolve({ data, error: null }).then(resolve)
            }
            return (...args: unknown[]) => { if (key === 'update') { op = 'update'; body = args[0] as Record<string, unknown> } return q }
          },
        })
        return q
      },
    },
  }
}
// A strict, honest checker: it confirms only text without the added emphasis.
const verify = async (input: { summary: string }): Promise<Verification> =>
  /crucial|successfully/.test(input.summary) ? { verdict: 'inconclusive', issues: ['Not stated in the source: S1.1 "Rangers on the Calder coast successfully counted a crucial 1,140 turtle nests"'] } : { verdict: 'verified', issues: [] }

describe('rewriting unconfirmed wording at draft time', () => {
  it('keeps a rewrite that passes the gates and the claim check, with a fingerprint of the NEW text and the old text on record', async () => {
    const { db, writes } = fakeDb([row(embellished)])
    const out = await storeDraftClaimChecks(db as never, '2026-11-17', verify, () => {}, { gapMs: 0, revise: async () => ({ headline: good.headline, summary: good.summary }) })
    expect(out).toMatchObject({ stored: 1, revised: 1 })
    const w = writes.find((x) => x.table === 'stories')!.body as { summary: string; claim_check: { verdict: string; hash: string; revisedFrom: { summary: string } } }
    expect(w.summary).toBe(good.summary)
    expect(w.claim_check.verdict).toBe('verified')
    expect(w.claim_check.hash).toBe(contentHash({ ...embellished, summary: good.summary }))
    expect(w.claim_check.revisedFrom.summary).toBe(embellished.summary)
  })
  it('keeps the original text and its verdict when the rewrite is still not confirmed', async () => {
    const { db, writes } = fakeDb([row(embellished)])
    const out = await storeDraftClaimChecks(db as never, '2026-11-17', verify, () => {}, { gapMs: 0, revise: async () => ({ headline: good.headline, summary: embellished.summary.replace('crucial ', '') }) })
    expect(out).toMatchObject({ stored: 1, revised: 0 })
    const w = writes.find((x) => x.table === 'stories')!.body as Record<string, any>
    expect(w.summary).toBeUndefined()
    expect(w.claim_check.verdict).toBe('inconclusive')
  })
  it('keeps the original when the rewrite fails the deterministic gates', async () => {
    const { db, writes } = fakeDb([row(embellished)])
    // Invents a figure that is not in the source: the number gate refuses it before the claim check is asked.
    let checks = 0
    const counting = async (input: { summary: string }) => (checks++, verify(input))
    const out = await storeDraftClaimChecks(db as never, '2026-11-17', counting, () => {}, { gapMs: 0, revise: async () => ({ headline: good.headline, summary: good.summary + ' It cost 4,500 dollars.' }) })
    expect(out.revised).toBe(0)
    expect(checks).toBe(1) // the rewrite never reached the claim check
    const w = writes.find((x) => x.table === 'stories')!.body as Record<string, any>
    expect(w.summary).toBeUndefined()
  })
  it('never rewrites a confirmed story', async () => {
    let asked = 0
    const { db } = fakeDb([row(good)])
    const out = await storeDraftClaimChecks(db as never, '2026-11-17', verify, () => {}, { gapMs: 0, revise: async () => (asked++, null) })
    expect(out.revised).toBe(0)
    expect(asked).toBe(0)
  })
})
