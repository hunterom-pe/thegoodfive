import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SCHEDULE } from '../src/lib/schedule'
import { contentHash, epochSeconds, runAutoPublish, VERIFY_CONCURRENCY, type StoredClaimCheck, type PublishDecision, type PublishRunRecord, type PublishStore, type SourceChecker, type StoredEdition } from './autopublish'
import { backup, DATE, edition, fiveGood, NOW, story } from './fixtures'
import { trackedNotifier, webhookNotifier } from './alerts'
import type { ClaimVerifier, Verification } from './pipeline/verify'
import { evaluateStory } from './pipeline/gates'

/** An in-memory stand-in for the database that obeys the same rules as auto_publish_edition(). */
class MemoryStore implements PublishStore {
  published: { editionId: string; primary: string[]; rejections: { id: string; reason: string }[] }[] = []
  lastChecked: { id: string; hash: string; v: number }[] = []
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
  async publish(editionId: string, _date: string, primary: string[], rejections: { id: string; reason: string }[], checked: { id: string; hash: string; v: number }[]): Promise<PublishDecision> {
    if (this.failWith?.op === 'publish') throw new Error(this.failWith.message)
    this.lastChecked = checked
    const run = this.lock.then(async () => {
      await new Promise((r) => setTimeout(r, 5)) // time for a competing attempt to arrive
      const ed = this.ed!
      if (ed.status === 'published') return 'already_published' as const
      if (ed.status !== 'draft') return 'held' as const
      if (primary.length !== 5) throw new Error('Exactly five distinct stories are required.')
      // Like the database function: every chosen story must still be exactly what was checked.
      if (primary.some((id) => !checked.some((c) => c.id === id && c.hash === contentHash(ed.stories.find((s) => s.id === id)!)))) return 'changed' as const
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
  const at = (fetchImpl: unknown) => webhookNotifier('https://hooks.example.com/abc', fetchImpl as typeof fetch)
  it('sends a webhook message and reports it delivered', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok'))
    expect(await at(fetchSpy)('Nothing was published.')).toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body.text).toContain('Nothing was published.')
    expect(body.content).toBe(body.text)
  })
  it('reports an error status instead of pretending the alert was delivered', async () => {
    for (const status of [400, 404, 429, 500, 503]) {
      const r = await at(async () => new Response('nope', { status }))('x')
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining(`HTTP ${status}`) })
    }
  })
  it('reports an unreachable or timed-out webhook, without throwing and without leaking its address', async () => {
    const down = await at(async () => { throw new Error('getaddrinfo ENOTFOUND hooks.example.com') })('x')
    expect(down).toMatchObject({ ok: false, error: 'The alert webhook could not be reached.' })
    const slow = await at(async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })('x')
    expect(slow).toMatchObject({ ok: false, error: 'The alert webhook timed out.' })
    expect(JSON.stringify([down, slow])).not.toContain('hooks.example.com')
  })
  it('does nothing without a webhook; an insecure one is reported as misconfigured', async () => {
    const fetchSpy = vi.fn()
    expect(await webhookNotifier(undefined, fetchSpy as unknown as typeof fetch)('x')).toMatchObject({ ok: true, skipped: true })
    expect(await webhookNotifier('http://insecure.example.com', fetchSpy as unknown as typeof fetch)('x')).toMatchObject({ ok: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('a tracked notifier remembers every failed delivery and never throws', async () => {
    const t = trackedNotifier(async () => ({ ok: false, error: 'The alert webhook answered HTTP 500.' }))
    await t.notify('a')
    await t.notify('b')
    expect(t.failures).toEqual(['The alert webhook answered HTTP 500.', 'The alert webhook answered HTTP 500.'])
    const thrower = trackedNotifier(async () => { throw new Error('boom') })
    await expect(thrower.notify('x')).resolves.toBeUndefined()
    expect(thrower.failures[0]).toMatch(/could not be sent: boom/)
  })
})

describe('failures during publication are visible, and never stop cleanup', () => {
  it('records that an alert was not delivered, and still records the outcome', async () => {
    const store = new MemoryStore(edition(fiveGood().slice(0, 4))) // only four stories: a failure that alerts
    const notify = vi.fn(async () => ({ ok: false, error: 'The alert webhook answered HTTP 500.' }))
    const out = await go(store, { notify })
    expect(out.status).toBe('failed')
    expect(notify).toHaveBeenCalled()
    expect(store.runs).toHaveLength(1)
    expect(store.runs[0].details.alertFailures).toEqual(['The alert webhook answered HTTP 500.'])
  })
  it('a webhook that throws cannot break the run', async () => {
    const store = new MemoryStore(edition(fiveGood().slice(0, 4)))
    const out = await go(store, { notify: async () => { throw new Error('boom') } })
    expect(out.status).toBe('failed')
    expect(store.runs[0].details.alertFailures?.[0]).toMatch(/boom/)
  })
  it('when the outcome cannot be saved, someone is told, and the result is still returned', async () => {
    const store = new MemoryStore(edition(fiveGood()), { op: 'record', message: 'permission denied for table publish_runs' })
    const notify = vi.fn(async () => {})
    const out = await go(store, { notify })
    expect(out.status).toBe('published') // the database change itself went through
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/record could not be saved.*permission denied/))
  })
})

describe('content edited after it was checked', () => {
  it('the audit case: moving the source date so the story is too old changes the fingerprint, and the gate rejects it', () => {
    const s = story(0)
    const stale = { ...s, sourcePublishedAt: new Date(NOW.getTime() - 6 * 86_400_000).toISOString() }
    expect(contentHash(stale)).not.toBe(contentHash(s))
    expect(evaluateStory({ ...stale }, { now: NOW, recentUrls: new Set() }).failures.map((f) => f.code)).toContain('stale')
  })
  it('the same moment written differently fingerprints the same, as it does in the database', () => {
    const s = story(0)
    for (const same of ['2026-11-14T04:00:00Z', '2026-11-14T04:00:00+00:00', '2026-11-14T04:00:00.000+00:00', '2026-11-13T21:00:00-07:00', '2026-11-14T04:00:00.999999+00:00'])
      expect(contentHash({ ...s, sourcePublishedAt: same }), same).toBe(contentHash({ ...s, sourcePublishedAt: '2026-11-14T04:00:00Z' }))
    expect(epochSeconds('2026-11-14T04:00:00Z')).toBe('1794628800')
    expect(epochSeconds(null)).toBe('')
    expect(epochSeconds('not a date')).toMatch(/^unreadable:/)
  })
  it('refuses to publish when the source date is moved during the claim check', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const verify: ClaimVerifier = async () => {
      store.ed!.stories[1].sourcePublishedAt = new Date(NOW.getTime() - 6 * 86_400_000).toISOString()
      return { verdict: 'verified', issues: [] }
    }
    const out = await go(store, { verify })
    expect(out.status).toBe('skipped')
    expect(store.published).toHaveLength(0)
  })

  it('refuses to publish when a chosen story is edited while the claim check is running', async () => {
    const store = new MemoryStore(edition([...fiveGood(), backup(5)]))
    const notify = vi.fn(async () => {})
    const verify: ClaimVerifier = async () => {
      store.ed!.stories[2].summary += ' An editor added this sentence while the check was running.' // lands between check and publish
      return { verdict: 'verified', issues: [] }
    }
    const out = await go(store, { verify, notify })
    expect(out.status).toBe('skipped')
    expect(out.reason).toMatch(/edited after it was checked/)
    expect(store.published).toHaveLength(0)
    expect(store.ed!.status).toBe('draft')
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('edited after it was checked'))
  })
  it('publishes normally, and passes the fingerprint of exactly what was read', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const out = await go(store)
    expect(out.status).toBe('published')
    expect(store.lastChecked).toHaveLength(5)
    expect(store.lastChecked[0]).toEqual({ id: 's0', hash: contentHash(store.ed!.stories[0]), v: 2 })
  })
  it('the fingerprint changes with any checked field and ignores the rest', () => {
    const base = story(0)
    const h = contentHash(base)
    for (const change of [{ headline: base.headline + '!' }, { summary: base.summary + ' x' }, { category: 'health' }, { sourceName: 'Other' }, { sourceUrl: base.sourceUrl + '/b' }, { sourceMaterial: (base.sourceMaterial ?? '') + ' more' }, { sourcePublishedAt: '2026-11-01T00:00:00Z' }, { sourcePublishedAt: null }, { aiRationale: 'Different assessment.' }]) {
      expect(contentHash({ ...base, ...change }), JSON.stringify(Object.keys(change))).not.toBe(h)
    }
    expect(contentHash({ ...base, role: 'backup' } as typeof base)).toBe(h)
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
  it('publishes only confirmed stories, reading every candidate that passed the other checks in one go', async () => {
    const verify = vi.fn(confirms)
    const store = new MemoryStore(edition([...fiveGood(), backup(5)]))
    expect((await go(store, { verify })).status).toBe('published')
    expect(verify).toHaveBeenCalledTimes(6) // the five and the spare, together: no second round to wait for
    expect(store.published[0].primary).toEqual(['s0', 's1', 's2', 's3', 's4'])
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
  it('replaces a story the check could not confirm with a confirmed backup, instead of holding the whole edition', async () => {
    const unsure = story(2)
    const store = new MemoryStore(edition([...fiveGood(), backup(5), backup(6)]))
    const out = await go(store, { verify: claim({ [unsure.headline]: 'inconclusive' }) })
    expect(out.status).toBe('published')
    expect(store.published[0].primary).not.toContain('s2')
    expect(store.published[0].primary).toContain('b5')
    expect(out.record.details.needsReview?.[0]).toMatchObject({ verdict: 'inconclusive' })
    expect(out.record.details.rejected?.some((r) => r.reasons.join(' ').includes('Claim check'))).toBe(true)
  })
  it('holds the edition when too few stories can be confirmed, and says so', async () => {
    const unsure = story(2)
    const store = new MemoryStore(edition(fiveGood())) // no backups to step in
    const out = await go(store, { verify: claim({ [unsure.headline]: 'inconclusive' }) })
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/Held for an editor: only 4 of 5 stories could be confirmed/)
    expect(store.published).toHaveLength(0)
  })
  it('holds the edition, naming the cause, when the claim check cannot run at all', async () => {
    const down: ClaimVerifier = async () => ({ verdict: 'inconclusive', unavailable: true, issues: ['The claim check could not run: HTTP 500'] })
    const store = new MemoryStore(edition([...fiveGood(), backup(5), backup(6)]))
    const out = await go(store, { verify: down })
    expect(out.status).toBe('failed')
    expect(out.reason).toMatch(/Held for an editor: the claim check could not run or finish/)
    expect(store.published).toHaveLength(0)
    expect(out.record.details.needsReview?.every((n) => n.verdict === 'unavailable')).toBe(true)
  })
  it('a partial outage still publishes when five stories were confirmed', async () => {
    const flaky: ClaimVerifier = async ({ headline }) => (headline === story(2).headline ? { verdict: 'inconclusive', unavailable: true, issues: ['timeout'] } : { verdict: 'verified', issues: [] })
    const store = new MemoryStore(edition([...fiveGood(), backup(5)]))
    const out = await go(store, { verify: flaky })
    expect(out.status).toBe('published')
    expect(store.published[0].primary).toContain('b5')
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
    expect(out.reason).toMatch(/could not run or finish/)
    expect(store.published).toHaveLength(0)
  })
  it('a dry run reports the same holds without recording anything', async () => {
    const store = new MemoryStore(edition(fiveGood()))
    const out = await go(store, { verify: undefined, dryRun: true })
    expect(out.status).toBe('failed')
    expect(store.runs).toHaveLength(0)
  })
})

describe('photo coverage', () => {
  it('warns, without blocking, when a published story would show artwork', async () => {
    const stories = fiveGood().map((s, i) => ({ ...s, hasPublicPhoto: i !== 2 }))
    const store = new MemoryStore(edition(stories))
    const out = await go(store)
    expect(out.status).toBe('published')
    expect(out.record.details.warnings?.join(' ')).toMatch(/no approved photo/)
    expect(out.record.details.warnings?.filter((w) => /no approved photo/.test(w))).toHaveLength(1)
  })
})

describe('claim checks under real-world conditions (the 16 November failure)', () => {
  const ok: Verification = { verdict: 'verified', issues: [] }
  it('keeps every check that finished: one slow story times out alone, and a confirmed backup takes its place', async () => {
    const slowOne = story(2)
    const verify: ClaimVerifier = ({ headline }, signal) =>
      headline === slowOne.headline ? new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))) : Promise.resolve(ok)
    const store = new MemoryStore(edition([...fiveGood(), backup(5)]))
    const out = await go(store, { verify, verifyBudgetMs: 50 })
    expect(out.status, out.reason).toBe('published')
    expect(store.published[0].primary).not.toContain('s2')
    expect(store.published[0].primary).toContain('b5')
    expect(out.record.details.needsReview).toEqual([expect.objectContaining({ verdict: 'unavailable', issues: ['The claim check timed out.'] })])
  })
  it('cancels unfinished checks at the deadline, so the job ends instead of hanging', async () => {
    const signals: AbortSignal[] = []
    const verify: ClaimVerifier = (_s, signal) => {
      signals.push(signal!)
      return new Promise(() => {}) // never answers, and ignores the signal: the deadline must still end the run
    }
    const started = Date.now()
    const out = await go(new MemoryStore(edition(fiveGood())), { verify, verifyBudgetMs: 40 })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(out.status).toBe('failed')
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((s) => s.aborted)).toBe(true)
  })
  it('runs at most a few checks at once (bursts are what the provider refuses)', async () => {
    let inFlight = 0
    let most = 0
    const verify: ClaimVerifier = async () => {
      most = Math.max(most, ++inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return ok
    }
    expect((await go(new MemoryStore(edition([...fiveGood(), backup(5), backup(6), backup(7)])), { verify })).status).toBe('published')
    expect(most).toBeLessThanOrEqual(VERIFY_CONCURRENCY)
  })
  it('reuses a check stored at draft time when the text is unchanged, and never when it changed or the check did not run', async () => {
    const stories = fiveGood().map((s) => ({ ...s, claimCheck: { verdict: 'verified', issues: [], hash: contentHash(s), checkedAt: NOW.toISOString() } as StoredClaimCheck }))
    stories[1] = { ...stories[1], summary: stories[1].summary + ' Edited after the check.' } // fingerprint no longer matches
    stories[3] = { ...stories[3], claimCheck: { ...stories[3].claimCheck!, verdict: 'inconclusive', unavailable: true, issues: ['timed out'] } }
    const verify = vi.fn(async () => ok)
    const out = await go(new MemoryStore(edition(stories)), { verify })
    expect(out.status).toBe('published')
    expect(verify).toHaveBeenCalledTimes(2) // only the edited story and the one whose stored check never ran
  })
  it('a stored conflict is honoured without asking again', async () => {
    const stories = fiveGood().map((s) => ({ ...s, claimCheck: { verdict: 'verified', issues: [], hash: contentHash(s), checkedAt: '' } as StoredClaimCheck }))
    stories[0] = { ...stories[0], claimCheck: { verdict: 'contradicted', issues: ['Conflicts with the source: S1.1'], hash: contentHash(stories[0]), checkedAt: '' } }
    const verify = vi.fn(async () => ok)
    const out = await go(new MemoryStore(edition([...stories, backup(5)])), { verify })
    expect(out.status).toBe('published')
    expect(store_primary(out)).not.toContain(stories[0].headline)
    expect(verify).toHaveBeenCalledTimes(1) // just the backup
  })
})
const store_primary = (out: Awaited<ReturnType<typeof runAutoPublish>>) => out.record.details.accepted?.map((a) => a.headline) ?? []

describe('one deadline for the whole publish run', () => {
  it('gives the claim checks only the time left after loading and source checks', async () => {
    const slowSources: SourceChecker = () => new Promise((r) => setTimeout(() => r({ ok: true }), 60))
    const neverAnswers: ClaimVerifier = () => new Promise(() => {})
    const started = Date.now()
    const out = await go(new MemoryStore(edition(fiveGood())), { checkSource: slowSources, verify: neverAnswers, runBudgetMs: 100, verifyBudgetMs: 10_000 })
    expect(out.status).toBe('failed')
    expect(Date.now() - started).toBeLessThan(2_000) // not the 10s verify budget: the run's own deadline wins
  })
})
