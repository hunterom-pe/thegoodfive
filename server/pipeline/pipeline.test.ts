import { describe, expect, it } from 'vitest'
import { openAiClient, type AiClient } from './ai.ts'
import { allowedByRobots } from './article.ts'
import { assemble, rank, ungroundedNumbers, ungroundedQuotes, type Shortlisted } from './curate.ts'
import { dedupe, normalizeUrl, titleSimilarity, withinWindow } from './dedupe.ts'
import { interleave, runPipeline } from './pipeline.ts'
import { parseFeed } from './rss.ts'
import { parseGdelt } from './gdelt.ts'
import type { Candidate, Evaluation } from './types.ts'

const W = ['salmon','vaccine','glacier','telescope','library','orchard','reef','solar','wetland','clinic','satellite','school','forest','harvest','bridge','garden','coral','battery','seedling','observatory','volunteers','river','lantern','meadow','trial']
const NOW = Date.parse('2026-11-13T12:00:00Z')
const cand = (n: number, over: Partial<Candidate> = {}): Candidate => ({
  id: `c${n}`, title: `${W[n % W.length]} ${W[(n * 7 + 3) % W.length]} ${W[(n * 11 + 5) % W.length]} ${W[(n * 13 + 1) % W.length]} unique${n}`, url: `https://example.org/${n}`, sourceName: 'Example', publishedAt: '2026-11-13T06:00:00Z', excerpt: 'x'.repeat(400), via: 'RSS: Example', trust: 2, ...over,
})
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

describe('feeds', () => {
  it('parses RSS 2.0 and drops items without a web link', () => {
    const xml = `<rss><channel>
      <item><title>Good &amp; useful</title><link>https://ex.org/a?utm_source=x</link><pubDate>Thu, 12 Nov 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;Body text&lt;/p&gt;</description></item>
      <item><title>No link</title></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link></item></channel></rss>`
    const items = parseFeed(xml, { name: 'Test (Section)', url: 'u', trust: 3 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title: 'Good & useful', sourceName: 'Test', publishedAt: '2026-11-12T08:00:00.000Z', excerpt: 'Body text', trust: 3 })
  })
  it('cleans entity-escaped, tracked article links', () => {
    const xml = `<rss><channel><item><title>T</title><link>https://www.bbc.co.uk/news/articles/abc?at_medium=RSS&amp;at_campaign=rss</link></item></channel></rss>`
    expect(parseFeed(xml, { name: 'BBC', url: 'u', trust: 3 })[0].url).toBe('https://www.bbc.co.uk/news/articles/abc')
  })
  it('parses Atom', () => {
    const xml = `<feed><entry><title>Atom story</title><link rel="alternate" href="https://ex.org/atom"/><published>2026-11-12T08:00:00Z</published><summary>S</summary></entry></feed>`
    expect(parseFeed(xml, { name: 'A', url: 'u', trust: 2 })[0].url).toBe('https://ex.org/atom')
  })
  it('parses GDELT and its timestamp format', () => {
    const [a] = parseGdelt({ articles: [{ url: 'https://ex.org/g', title: 'Headline', seendate: '20261113T101500Z', domain: 'ex.org', language: 'English' }, { url: 'ftp://bad', title: 'x', seendate: '', domain: '', language: '' }] })
    // The index time is a discovery time, never a publication date.
    expect(a).toMatchObject({ publishedAt: null, discoveredAt: '2026-11-13T10:15:00Z', via: 'GDELT', excerpt: '' })
  })
})

describe('dedupe', () => {
  it('treats tracking-link variants as one article', () => {
    expect(normalizeUrl('https://www.ex.org/a/?utm_source=x#top')).toBe(normalizeUrl('https://ex.org/a'))
  })
  it('collapses the same event from two outlets, keeping the more trusted', () => {
    const a = cand(1, { title: 'Scientists restore river salmon after twenty years', trust: 1 })
    const b = cand(2, { title: 'Salmon return to restored river after twenty years, scientists say', trust: 3, url: 'https://other.org/x' })
    expect(titleSimilarity(a.title, b.title)).toBeGreaterThan(0.5)
    const out = dedupe([a, b], [], 0.5)
    expect(out).toHaveLength(1)
    expect(out[0].trust).toBe(3)
  })
  it('drops stories already used in a recent edition and keeps ids unique', () => {
    const out = dedupe([cand(1), cand(2)], ['https://www.example.org/1?utm_medium=x'])
    expect(out.map((c) => c.url)).toEqual(['https://example.org/2'])
  })
  it('keeps only the last 72 hours', () => {
    const old = cand(1, { publishedAt: '2026-11-01T00:00:00Z' })
    expect(withinWindow([old, cand(2)], 72, NOW)).toHaveLength(1)
  })
})

describe('grounding checks', () => {
  const material = 'The team said “we just kept turning up” and counted 1,140 nests in 2026, up 64 per cent.'
  it('finds quotes that are not in the source', () => {
    expect(ungroundedQuotes('One said “we just kept turning up” daily.', material)).toEqual([])
    expect(ungroundedQuotes('She said “this changes everything for us all”.', material)).toHaveLength(1)
  })
  it('finds figures that are not in the source', () => {
    expect(ungroundedNumbers('A record 1140 nests, up 64 per cent in 2026.', material)).toEqual([])
    expect(ungroundedNumbers('Nests rose 300 per cent.', material)).toEqual(['300'])
  })
})

describe('assembly', () => {
  const shortlist: Shortlisted[] = Array.from({ length: 9 }, (_, i) => ({
    candidate: cand(i + 1), evaluation: { id: `c${i + 1}`, isGoodNews: true, category: 'science', significance: 4, credibility: 4, reason: 'r' }, material: `Source text with 12 nests. ${'y'.repeat(400)}`,
  }))
  const w = (id: string, role: 'primary' | 'backup', over = {}) => ({ id, role, category: 'nature' as const, headline: `Headline ${id}`, summary: words(70), why_good_news: 'why', preliminary: false, claims_to_check: ['claim'], ...over })

  it('numbers five primaries and three backups in order, with source attribution', () => {
    const written = [...[1, 2, 3, 4, 5].map((n) => w(`c${n}`, 'primary')), ...[6, 7, 8].map((n) => w(`c${n}`, 'backup'))]
    const out = assemble(written, shortlist)
    expect(out.map((s) => `${s.role}${s.position}`)).toEqual(['primary1', 'primary2', 'primary3', 'primary4', 'primary5', 'backup1', 'backup2', 'backup3'])
    expect(out[0]).toMatchObject({ source_url: 'https://example.org/1', source_name: 'Example', source_published_at: '2026-11-13T06:00:00Z' })
  })
  it('never exceeds five primaries or three backups, and ignores unknown and repeated ids', () => {
    const written = [...[1, 2, 3, 4, 5, 6, 7].map((n) => w(`c${n}`, 'primary')), w('c8', 'backup'), w('c8', 'backup'), w('nope', 'primary')]
    const out = assemble(written, shortlist)
    expect(out.filter((s) => s.role === 'primary')).toHaveLength(5)
    expect(out.filter((s) => s.role === 'backup')).toHaveLength(3)
    expect(new Set(out.map((s) => s.source_url)).size).toBe(out.length)
  })
  it('promotes backups into any empty primary slot so the five are whole', () => {
    const written = [...[1, 2, 3, 4].map((n) => w(`c${n}`, 'primary')), ...[5, 6, 7].map((n) => w(`c${n}`, 'backup'))]
    const out = assemble(written, shortlist)
    expect(out.filter((s) => s.role === 'primary')).toHaveLength(5)
    expect(out.filter((s) => s.role === 'backup')).toHaveLength(2)
    expect(out[4]).toMatchObject({ role: 'primary', position: 5, source_url: 'https://example.org/5' })
  })
  it('excludes stories with an invented quotation and flags invented figures', () => {
    const written = [w('c1', 'primary', { summary: `${words(70)} “a quote nobody ever said”` }), w('c2', 'primary', { summary: `${words(70)} 999 people` })]
    const out = assemble(written, shortlist)
    expect(out).toHaveLength(1)
    expect(out[0].claims_to_check.join(' ')).toMatch(/999/)
  })
  it('flags preliminary research and returns fewer than eight when fewer qualify', () => {
    const out = assemble([w('c1', 'primary', { preliminary: true })], shortlist)
    expect(out).toHaveLength(1)
    expect(out[0].claims_to_check.join(' ')).toMatch(/preliminary/i)
  })
})

describe('ranking', () => {
  it('drops non-good, low-credibility and trivial stories, best first', () => {
    const cs = [cand(1), cand(2), cand(3), cand(4)]
    const ev = (id: string, o: Partial<Evaluation>): Evaluation => ({ id, isGoodNews: true, category: 'nature', significance: 4, credibility: 4, reason: '', ...o })
    const out = rank(cs, [ev('c1', { isGoodNews: false }), ev('c2', { credibility: 2 }), ev('c3', { significance: 5 }), ev('c4', { significance: 3 })], NOW, 10)
    expect(out.map((r) => r.candidate.id)).toEqual(['c3', 'c4'])
  })
})

describe('screening pool', () => {
  it('shares the pool across sources instead of letting one feed fill it', () => {
    const big = Array.from({ length: 50 }, (_, i) => cand(i + 1, { via: 'RSS: Big', publishedAt: '2026-11-13T09:00:00Z' }))
    const small = Array.from({ length: 5 }, (_, i) => cand(100 + i, { via: 'RSS: Small', publishedAt: '2026-11-12T09:00:00Z' }))
    const pool = interleave([...big, ...small], 20)
    expect(pool).toHaveLength(20)
    expect(pool.filter((c) => c.via === 'RSS: Small')).toHaveLength(5)
  })
})

describe('AI client provider compatibility', () => {
  it('falls back to plain JSON mode when a provider rejects strict schemas, and unwraps code fences', async () => {
    const real = globalThis.fetch
    const bodies: { response_format: { type: string }; messages: { content: string }[] }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://free.example/v1/chat/completions')
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      if (body.response_format.type === 'json_schema') return new Response('{"error":"unsupported"}', { status: 400 })
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{"ok":true}\n```' } }] }))
    }) as unknown as typeof fetch
    const out = await openAiClient('k', 'm', 'https://free.example/v1/').json<{ ok: boolean }>({ system: 'S', user: 'U', name: 'n', schema: { type: 'object' }, maxTokens: 10 })
    globalThis.fetch = real
    expect(out).toEqual({ ok: true })
    expect(bodies.map((b) => b.response_format.type)).toEqual(['json_schema', 'json_object'])
    expect(bodies[1].messages[0].content).toMatch(/JSON Schema/)
  })
})

describe('robots.txt', () => {
  it('honours disallow rules including wildcards', async () => {
    const real = globalThis.fetch
    globalThis.fetch = (async () => new Response('User-agent: *\nDisallow: /private\nDisallow: /*?s=\n')) as typeof fetch
    expect(await allowedByRobots('https://robots-a.test/story/1')).toBe(true)
    expect(await allowedByRobots('https://robots-a.test/private/x')).toBe(false)
    expect(await allowedByRobots('https://robots-a.test/page?s=cats')).toBe(false)
    globalThis.fetch = real
  })
})

describe('full pipeline with a fake AI', () => {
  // Realistic enough to pass the gates: trusted domain, fresh date, and a summary built from the source's own words.
  const VOCAB = 'volunteers community restored wetland habitat returned shelter planted native grasses neighbours gathered monitoring rivers recovered fisheries sanctuary wildlife protected landscape seedlings nurseries villagers partnership funding schools students teachers libraries clinics nurses vaccines hospitals treatment patients research laboratory scientists discovered observations telescope galaxies'.split(' ')
  const material = Array.from({ length: 4 }, () => VOCAB.join(' ')).join('. ') + '.'
  const sentence = (n: number) => Array.from({ length: n }, (_, i) => VOCAB[i % VOCAB.length]).join(' ')
  const pool = Array.from({ length: 30 }, (_, i) => cand(i + 1, { url: `https://www.bbc.co.uk/news/articles/${i + 1}`, sourceName: 'BBC News', publishedAt: '2026-11-13T06:00:00Z' }))
  const fakeAi = (calls: string[]): AiClient => ({
    async json(req) {
      calls.push(req.name)
      const ids = [...req.user.matchAll(/"id":"(c\d+)"/g)].map((m) => m[1])
      if (req.name === 'screening') {
        return { evaluations: ids.map((id, i) => ({ id, is_good_news: i % 2 === 0, category: 'nature', significance: 4, credibility: 4, reason: 'ok' })) } as never
      }
      const heads = ['Volunteers restored the wetland habitat along the river', 'Schools and libraries gathered new funding for students', 'Clinics and nurses reached patients with vaccines', 'Scientists discovered native grasses recovering across landscapes', 'Villagers protected wildlife in the new sanctuary landscape', 'Teachers planted seedlings in nurseries near neighbours', 'Researchers observed galaxies through a donated telescope array', 'Fisheries recovered after partnership funding reached rivers', 'Hospitals shared treatment research with laboratory scientists', 'Community monitoring helped shelter birds returned to habitat']
      return { stories: ids.slice(0, 10).map((id, i) => ({ id, role: i < 5 ? 'primary' : 'backup', category: 'nature', headline: heads[i], summary: sentence(70), why_good_news: 'why', preliminary: false, claims_to_check: ['c'], image_query: 'wetland river habitat', about_specific_person: false })) } as never
    },
  })
  it('makes exactly two AI calls and returns five plus three, after fact-checking', async () => {
    const calls: string[] = []
    const result = await runPipeline({ ai: fakeAi(calls), today: '2026-11-13', now: new Date(NOW), discover: async () => pool, fetchMaterial: async () => ({ siteName: null, description: null, images: [], text: material }) })
    expect(calls).toEqual(['screening', 'edition'])
    expect(result.stats).toMatchObject({ discovered: 30, primary: 5, backup: 3, accepted: 8 })
    expect(result.stories.filter((s) => s.role === 'rejected')).toHaveLength(0) // the two spares are simply not kept
    expect(result.stories[0].source_material).toContain('volunteers')
    expect(result.stats.screened).toBeGreaterThan(20)
  })
  it('rejects, with reasons, a story that cannot be supported by its source', async () => {
    const lying: AiClient = { async json(req) { const r = await fakeAi([]).json<{ stories: { summary: string }[] }>(req); if (req.name === 'edition') r.stories[0].summary += ' It cost 4,500 dollars.'; return r as never } }
    const result = await runPipeline({ ai: lying, today: '2026-11-13', now: new Date(NOW), discover: async () => pool, fetchMaterial: async () => ({ siteName: null, description: null, images: [], text: material }) })
    const rejected = result.stories.filter((s) => s.role === 'rejected')
    expect(rejected.some((s) => /4,500|4500/.test(s.rejected_reason ?? ''))).toBe(true)
    expect(result.stories.filter((s) => s.role === 'primary')).toHaveLength(5) // a backup stepped up
  })
  it('spends nothing when there are too few candidates, and excludes stories it cannot read', async () => {
    const calls: string[] = []
    const few = await runPipeline({ ai: fakeAi(calls), today: '2026-11-13', now: new Date(NOW), discover: async () => pool.slice(0, 3) })
    expect(few.stories).toEqual([])
    expect(calls).toEqual([])
    const unreadable = await runPipeline({ ai: fakeAi(calls), today: '2026-11-13', now: new Date(NOW), discover: async () => pool.map((c) => ({ ...c, excerpt: '' })), fetchMaterial: async () => null })
    expect(unreadable.stories).toEqual([])
    expect(calls).toEqual(['screening'])
  })
})
