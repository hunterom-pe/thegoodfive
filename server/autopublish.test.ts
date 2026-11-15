import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SCHEDULE } from '../src/lib/schedule'
import { runAutoPublish, type PublishDecision, type PublishRunRecord, type PublishStore, type SourceChecker, type StoredEdition } from './autopublish'
import { backup, DATE, edition, fiveGood, NOW, story } from './fixtures'
import { webhookNotifier } from './alerts'
import { judge, type ClaimVerifier } from './pipeline/verify'

/** An in-memory stand-in for the database that obeys the same rules as auto_publish_edition(). */
class MemoryStore implements PublishStore {
  published: { editionId: string; primary: string[]; rejections: { id: string; reason: string }[] }[] = []
  runs: PublishRunRecord[] = []
  recent: string[] = []
  private lock: Promise<void> = Promise.resolve()
  constructor(public ed: StoredEdition | null, public failWith?: { op: 'load' | 'recent' | 'publish' | 'record'; message: string }) {}
  async loadEdition() {
    if (this.failWith?.op === 'load') throw new Error(this.failWith.message)
    return this.ed ? structuredClone(this.ed) : null
  }
  async recentSourceUrls() {
    if (this.failWith?.op === 'recent') throw new Error(this.failWith.message)
    return this.recent
  }
  async publish(editionId: string, _date: string, primary: string[], rejections: { id: string; reason: string }[]): Promise<PublishDecision> {
    if (this.failWith?.op === 'publish') throw new Error(this.failWith.message)
    const run = this.lock.then(async () => {
      await new Promise((r) => setTimeout(r, 5)) // time for a competing attempt to arrive
      const ed = this.ed!
      if (ed.status === 'published') return 'already_published' as const
      if (ed.status !== 'draft') return 'held' as const
      if (primary.length !== 5) throw new Error('Exactly five distinct stories are required.')
      ed.status = 'published'
      this.published.push({ editionId, primary, rejections })
      return 'published' as const
    })
    this.lock = run.then(() => undefined, () => undefined)
    return run
  }
  async record(run: PublishRunRecord) {
    if (this.failWith?.op === 'record') throw new Error(this.failWith.message)
    this.runs.push(run)
  }
}

const ok: SourceChecker = async () => ({ ok: true })
const confirms: ClaimVerifier = async () => ({ verdict: 'verified', issues: [] })
const go = (store: MemoryStore, over: Partial<Parameters<typeof runAutoPublish>[0]> = {}) =>
  runAutoPublish({ store, date: DATE, trigger: 'schedule', enabled: true, now: NOW, checkSource: ok, verify: confirms, ...over })

describe('automatic publication', () => {
  it('publishes five valid stories, in order, and records it', async () => {
    const store = new MemoryStore(edition([...fiveGood(), backup(5), backup(6)]))
    const out = await go(store)
    expect(out.status).toBe('published')
    expect(store.published).toHaveLength(1)
    expect(store.published[0].primary).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(store.ed!.status).toBe('published')
    expect(store.runs).toHaveLength(1)
    expect(store.runs[0]).toMatchObject({ status: 'published', trigger: 'schedule', date: DATE })
    expect(store.runs[0].details.accepted).toHaveLength(5)
  })

  it('does nothing at all when automatic publishing is disabled', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const load = vi.spyOn(store, 'loadEdition')
    const out = await go(store, { enabled: false })
    expect(out.status).toBe('disabled')
    expect(load).not.toHaveBeenCalled()
    expect(store.ed!.status).toBe('draft')
    expect(store.runs[0].status).toBe('disabled')
  })

  it('fails safely with fewer than five valid stories: publishes nothing and says why', async () => {
    const notify = vi.fn(async () => {})
    const stories = fiveGood()
    stories[0].sourceMaterial = 'too short'
    stories[1].sourceUrl = ''
    const store = new MemoryStore(edition(stories))
    const out = await go(store, { notify })
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/Only 3 of 5/)
    expect(store.published).toHaveLength(0)
    expect(store.ed!.status).toBe('draft')
    expect(out.record.details.rejected).toHaveLength(2)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('fails safely when there is no draft at all (generation failed): the previous edition stays', async () => {
    const notify = vi.fn(async () => {})
    const out = await go(new MemoryStore(null), { notify })
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/No draft was generated/)
    expect(out.reason).toMatch(/latest published edition stays/)
    expect(notify).toHaveBeenCalled()
  })

  it('replaces a story with a missing source link by a backup', async () => {
    const stories = [...fiveGood(), backup(5)]
    stories[2].sourceUrl = ''
    const store = new MemoryStore(edition(stories))
    const out = await go(store)
    expect(out.status).toBe('published')
    expect(store.published[0].primary).toEqual(['s0', 's1', 's3', 's4', 'b5'])
    expect(store.published[0].rejections[0]).toMatchObject({ id: 's2' })
    expect(store.published[0].rejections[0].reason).toMatch(/link/i)
  })

  it('rejects an unsupported numerical claim and uses a backup', async () => {
    const stories = [...fiveGood(), backup(5)]
    stories[0].summary += ' The scheme cost 7,500 dollars.'
    const store = new MemoryStore(edition(stories))
    const out = await go(store)
    expect(out.status).toBe('published')
    expect(store.published[0].primary).not.toContain('s0')
    expect(out.record.details.rejected![0].reasons.join(' ')).toMatch(/7,500|7500/)
  })

  it('rejects an invented quotation', async () => {
    const stories = [...fiveGood(), backup(5)]
    stories[1].summary += ' “This is the greatest day in our history,” said the mayor.'
    const out = await go(new MemoryStore(edition(stories)))
    expect(out.record.details.rejected![0].reasons.join(' ')).toMatch(/Quotation not found/)
  })

  it('rejects preliminary science or health reporting that is stated without qualification, and accepts it once qualified', async () => {
    const early = ' This was an early, small pilot study and more research is needed before the treatment is approved.'
    const unqualified = story(1, { category: 'health', sourceMaterial: story(1).sourceMaterial + early })
    const out = await go(new MemoryStore(edition([story(0), unqualified, story(2), story(3), story(4), backup(5)])))
    expect(out.record.details.rejected![0].reasons.join(' ')).toMatch(/preliminary or early-stage/)
    expect(out.status).toBe('published') // a backup took its place
    const qualified = story(1, { category: 'health', sourceMaterial: story(1).sourceMaterial + early, summary: story(1).summary + ' Early results suggest the recovery may last, though the study was small.' })
    const out2 = await go(new MemoryStore(edition([story(0), qualified, story(2), story(3), story(4)])))
    expect(out2.status).toBe('published')
  })

  it('never publishes two near-duplicate stories, nor the same article twice', async () => {
    const stories = [...fiveGood(), backup(5), backup(6)]
    stories[1] = story(0, { id: 's1', position: 2, headline: 'Rangers count a record number of turtle nests on the Calder coast', sourceUrl: 'https://www.bbc.co.uk/news/articles/other' })
    stories[2].sourceUrl = stories[3].sourceUrl // same article under two headlines
    const store = new MemoryStore(edition(stories))
    const out = await go(store)
    expect(out.status).toBe('published')
    const ids = store.published[0].primary
    expect(ids).not.toContain('s1')
    expect(ids.filter((id) => id === 's2' || id === 's3')).toHaveLength(1)
    expect(out.record.details.rejected!.map((r) => r.reasons.join(' ')).join(' ')).toMatch(/Near-duplicate/)
  })

  it('does not repeat an article that ran in a recent edition', async () => {
    const store = new MemoryStore(edition([...fiveGood(), backup(5)]))
    store.recent = ['https://www.bbc.co.uk/news/articles/c1?utm_source=x']
    const out = await go(store)
    expect(store.published[0].primary).not.toContain('s1')
    expect(out.record.details.rejected![0].reasons.join(' ')).toMatch(/already ran in a recent edition/)
  })

  it('leaves an already published edition completely alone', async () => {
    const store = new MemoryStore(edition(fiveGood(), 'published'))
    const out = await go(store)
    expect(out.status).toBe('skipped')
    expect(out.reason).toMatch(/already published/)
    expect(store.published).toHaveLength(0)
  })

  it('is idempotent: a repeated scheduled run (and the 8:00 retry) publishes nothing twice', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const first = await go(store)
    const second = await go(store, { trigger: 'retry' })
    const third = await go(store, { trigger: 'retry' })
    expect([first.status, second.status, third.status]).toEqual(['published', 'skipped', 'skipped'])
    expect(store.published).toHaveLength(1)
  })

  it('survives concurrent attempts: exactly one publishes', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const results = await Promise.all([go(store), go(store, { trigger: 'retry' }), go(store)])
    expect(results.filter((r) => r.status === 'published')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(2)
    expect(store.published).toHaveLength(1)
  })

  it('treats a manual editorial hold ("In review") as final: the robot never overrides an editor', async () => {
    const store = new MemoryStore(edition(fiveGood(), 'review'))
    const out = await go(store)
    expect(out.status).toBe('skipped')
    expect(out.reason).toMatch(/In review/)
    expect(store.published).toHaveLength(0)
  })

  it('re-checks manual edits: an edit that adds an unsupported figure is caught, a correction passes', async () => {
    const stories = [...fiveGood(), backup(5)]
    stories[3].summary = stories[3].summary.replace('twenty dollars', '2,000 dollars') // an editor's slip
    const out = await go(new MemoryStore(edition(stories)))
    expect(out.record.details.rejected!.some((r) => /2,000|2000/.test(r.reasons.join(' ')))).toBe(true)
    stories[3].summary = stories[3].summary.replace('2,000 dollars', 'twenty dollars') // the editor fixes it
    const out2 = await go(new MemoryStore(edition(stories)))
    expect(out2.record.details.rejected ?? []).toHaveLength(0)
  })

  it('a dry-run check reports the result but publishes and records nothing', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const out = await go(store, { trigger: 'check', dryRun: true, enabled: false })
    expect(out.status).toBe('dry_run')
    expect(store.published).toHaveLength(0)
    expect(store.runs).toHaveLength(0)
  })
})

describe('outages', () => {
  it('a database outage while reading fails safely and sends an alert', async () => {
    const notify = vi.fn(async () => {})
    const store = new MemoryStore(edition(fiveGood()), { op: 'load', message: 'connection refused' })
    const out = await go(store, { notify })
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/connection refused/)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('failed'))
    expect(store.ed!.status).toBe('draft')
  })

  it('a database that refuses the publish leaves the edition unpublished', async () => {
    const store = new MemoryStore(edition(fiveGood()), { op: 'publish', message: 'A chosen article already ran in a recent edition.' })
    const out = await go(store)
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/already ran/)
    expect(store.ed!.status).toBe('draft')
  })

  it('a failure to record the run does not break the run', async () => {
    const store = new MemoryStore(edition(fiveGood()), { op: 'record', message: 'disk full' })
    const out = await go(store, { log: () => {} })
    expect(out.status).toBe('published')
  })

  it('an unreachable or removed source article is rejected, never published on trust', async () => {
    const checks: SourceChecker = async (url) => (url.endsWith('/c1') ? { ok: false, reason: 'The article is gone (HTTP 404).' } : url.endsWith('/c2') ? { ok: false, reason: 'The article could not be reached (network error or timeout).' } : { ok: true })
    const store = new MemoryStore(edition([...fiveGood(), backup(5), backup(6)]))
    const out = await go(store, { checkSource: checks })
    expect(out.status).toBe('published')
    expect(store.published[0].primary).not.toContain('s1')
    expect(store.published[0].primary).not.toContain('s2')
  })

  it('if every source is down, nothing is published', async () => {
    const out = await go(new MemoryStore(edition(fiveGood())), { checkSource: async () => ({ ok: false, reason: 'The article could not be reached (network error or timeout).' }) })
    expect(out.status).toBe('failed')
  })

  it('images never decide publication: the publisher neither reads nor needs them', async () => {
    // Stories carry no image data here at all; a failed or missing photo falls back to artwork on the public site.
    const out = await go(new MemoryStore(edition(fiveGood())))
    expect(out.status).toBe('published')
  })
})

describe('dates and boundaries', () => {
  it('accepts a source just inside five days and rejects one just outside', async () => {
    const at = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()
    const inside = fiveGood()
    inside[0].sourcePublishedAt = at(119)
    expect((await go(new MemoryStore(edition(inside)))).status).toBe('published')
    const outside = [...fiveGood(), backup(5)]
    outside[0].sourcePublishedAt = at(121)
    const out = await go(new MemoryStore(edition(outside)))
    expect(out.record.details.rejected![0].reasons.join(' ')).toMatch(/days old/)
  })
  it('rejects undated and future-dated sources', async () => {
    const stories = [...fiveGood(), backup(5), backup(6)]
    stories[0].sourcePublishedAt = null
    stories[1].sourcePublishedAt = new Date(NOW.getTime() + 3 * 3_600_000).toISOString()
    const out = await go(new MemoryStore(edition(stories)))
    const why = out.record.details.rejected!.map((r) => r.reasons.join(' ')).join(' ')
    expect(why).toMatch(/no publication date/)
    expect(why).toMatch(/in the future/)
  })
})

describe('alerts', () => {
  it('sends a webhook message (and never throws) when configured', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok'))
    await webhookNotifier('https://hooks.example.com/abc', fetchSpy as unknown as typeof fetch)('Nothing was published.')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body.text).toContain('Nothing was published.')
    expect(body.content).toBe(body.text)
    await expect(webhookNotifier('https://hooks.example.com/abc', (async () => { throw new Error('down') }) as unknown as typeof fetch)('x')).resolves.toBeUndefined()
  })
  it('does nothing without a webhook, or with an insecure one', async () => {
    const fetchSpy = vi.fn()
    await webhookNotifier(undefined, fetchSpy as unknown as typeof fetch)('x')
    await webhookNotifier('http://insecure.example.com', fetchSpy as unknown as typeof fetch)('x')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('schedule consistency', () => {
  it('every scheduled Netlify function runs at the time the dashboard says it does', () => {
    const dir = new URL('../netlify/functions/', import.meta.url)
    const crons = readdirSync(dir)
      .filter((f) => f.startsWith('daily-'))
      .map((f) => ({ file: f, cron: /schedule: '([^']+)'/.exec(readFileSync(new URL(f, dir), 'utf8'))?.[1] }))
    expect(crons).toHaveLength(SCHEDULE.length)
    for (const job of SCHEDULE) expect(crons.map((c) => c.cron)).toContain(job.utcCron)
  })
})


describe('claim verification before publishing', () => {
  const claim = (verdicts: Record<string, 'verified' | 'contradicted' | 'inconclusive'>): ClaimVerifier => async ({ headline }) => {
    const v = verdicts[headline] ?? 'verified'
    return { verdict: v, issues: v === 'verified' ? [] : [`${v}: ${headline}`] }
  }
  it('publishes only after every story is confirmed', async () => {
    const verify = vi.fn(confirms)
    const store = new MemoryStore(edition([...fiveGood(), backup(5)]))
    expect((await go(store, { verify })).status).toBe('published')
    expect(verify).toHaveBeenCalledTimes(5) // the spare is never read
  })
  it('turns away a story whose claims conflict with its source and uses the next backup', async () => {
    const bad = story(1)
    const store = new MemoryStore(edition([story(0), bad, story(2), story(3), story(4), backup(5), backup(6)]))
    const out = await go(store, { verify: claim({ [bad.headline]: 'contradicted' }) })
    expect(out.status).toBe('published')
    expect(store.published[0].primary).not.toContain('s1')
    expect(store.published[0].primary).toContain('b5')
    expect(out.record.details.rejected?.some((r) => r.reasons.join(' ').includes('Claim check'))).toBe(true)
  })
  it('holds the whole edition when a story cannot be confirmed, instead of publishing it', async () => {
    const unsure = story(2)
    const store = new MemoryStore(edition([...fiveGood(), backup(5)]))
    const out = await go(store, { verify: claim({ [unsure.headline]: 'inconclusive' }) })
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/Held for an editor/)
    expect(store.published).toHaveLength(0)
    expect(out.record.details.needsReview?.[0].verdict).toBe('inconclusive')
  })
  it('holds the edition when no verifier is configured', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const out = await go(store, { verify: undefined })
    expect(out.status).toBe('failed')
    expect(store.published).toHaveLength(0)
  })
  it('holds the edition when the claim check times out', async () => {
    const slow: ClaimVerifier = () => new Promise(() => {})
    const store = new MemoryStore(edition(fiveGood()))
    const out = await go(store, { verify: slow, verifyBudgetMs: 20 })
    expect(out.status).toBe('failed')
    expect(out.record.details.needsReview?.[0].issues.join(' ')).toMatch(/timed out/)
    expect(store.published).toHaveLength(0)
  })
  it('a dry run reports the same holds without recording anything', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const out = await go(store, { verify: undefined, dryRun: true })
    expect(out.status).toBe('failed')
    expect(store.runs).toHaveLength(0)
  })
})

describe('judging the verifier’s answer', () => {
  const material = 'Rangers on the Calder coast counted 1,140 turtle nests this season, the most since records began in 1996. The council funded the programme.'
  const input = { headline: 'Rangers count turtle nests', summary: 'Rangers counted 1,140 turtle nests. The council funded the programme.', material }
  const supported = (evidence: string) => ({ claim: 'c', verdict: 'supported' as const, evidence })
  it('verifies when every claim is backed by a sentence that really is in the source', () => {
    expect(judge({ claims: [supported('Rangers on the Calder coast counted 1,140 turtle nests this season, the most since records began in 1996.'), supported('The council funded the programme.')] }, input).verdict).toBe('verified')
  })
  it('does not trust evidence that is not in the source', () => {
    expect(judge({ claims: [supported('Rangers on the Calder coast did not count turtle nests.'), supported('The council funded the programme.')] }, input).verdict).toBe('inconclusive')
  })
  it('is inconclusive when it skips sentences, says nothing, or finds claims the source lacks', () => {
    expect(judge({ claims: [supported('The council funded the programme.')] }, input).verdict).toBe('inconclusive')
    expect(judge({ claims: [] }, input).verdict).toBe('inconclusive')
    expect(judge({ claims: [{ claim: 'x', verdict: 'not_in_source', evidence: '' }, supported('The council funded the programme.')] }, input).verdict).toBe('inconclusive')
  })
  it('calls a conflict only when the cited sentence is real', () => {
    expect(judge({ claims: [{ claim: 'x', verdict: 'contradicted', evidence: 'The council funded the programme.' }, supported('The council funded the programme.')] }, input).verdict).toBe('contradicted')
    expect(judge({ claims: [{ claim: 'x', verdict: 'contradicted', evidence: 'A sentence that is not there at all, honestly.' }, supported('The council funded the programme.')] }, input).verdict).toBe('inconclusive')
  })
})
