import { describe, expect, it } from 'vitest'
import { declaredDate } from './article.ts'
import type { AiClient } from './ai.ts'
import { runPipeline } from './pipeline.ts'
import { parsePublication } from './pubdate.ts'
import { parseFeed } from './rss.ts'
import type { Candidate } from './types.ts'

describe('publication date versus the UTC day', () => {
  it('keeps the publisher’s own day: the ScienceDaily case from the QA report', () => {
    // 22:51 on 15 November in New York is 03:51 on 16 November UTC. The page says November 15.
    expect(parsePublication('Sun, 15 Nov 2026 22:51:01 EST')).toEqual({ at: '2026-11-16T03:51:01.000Z', on: '2026-11-15' })
  })
  it('keeps the printed day across timezone boundaries, both ways', () => {
    // Early morning in Auckland (UTC+13) is the previous day in UTC.
    expect(parsePublication('2026-11-16T00:30:00+13:00')).toEqual({ at: '2026-11-15T11:30:00.000Z', on: '2026-11-16' })
    // Late evening in Honolulu (UTC-10) is the next day in UTC.
    expect(parsePublication('2026-11-15T23:45:00-10:00')).toEqual({ at: '2026-11-16T09:45:00.000Z', on: '2026-11-15' })
    expect(parsePublication('Mon, 16 Nov 2026 00:05:00 GMT')?.on).toBe('2026-11-16')
  })
  it('treats a bare date as that day, without inventing a time of day that could cross midnight', () => {
    expect(parsePublication('2026-11-15')).toEqual({ at: '2026-11-15T12:00:00.000Z', on: '2026-11-15' })
  })
  it('refuses text that is not a real day', () => {
    for (const bad of ['', 'yesterday', '2026-02-30', '31 Feb 2026', 'Mon, 99 Nov 2026 10:00:00 GMT']) expect(parsePublication(bad)).toBeNull()
  })
  it('records both parts for a feed item, and never the UTC day alone', () => {
    const xml = '<rss><channel><item><title>T</title><link>https://www.sciencedaily.com/releases/a.htm</link><pubDate>Sun, 15 Nov 2026 22:51:01 EST</pubDate></item></channel></rss>'
    expect(parseFeed(xml, { name: 'ScienceDaily', url: 'u', trust: 2 })[0]).toMatchObject({ publishedAt: '2026-11-16T03:51:01.000Z', publishedOn: '2026-11-15' })
  })
  it('reads only what a page declares about itself', () => {
    expect(declaredDate('<meta property="article:published_time" content="2026-11-02T08:00:00-05:00">')).toBe('2026-11-02T08:00:00-05:00')
    expect(declaredDate('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-30T09:00:00Z"}</script>')).toBe('2026-10-30T09:00:00Z')
    expect(declaredDate('<p>Posted on 3 November 2026</p>')).toBeNull()
  })
})

describe('an old article newly discovered today', () => {
  const NOW = Date.parse('2026-11-16T15:00:00Z')
  const VOCAB = 'volunteers community restored wetland habitat returned shelter planted native grasses neighbours gathered monitoring rivers recovered fisheries sanctuary wildlife protected landscape seedlings nurseries villagers partnership funding schools students teachers libraries clinics nurses vaccines hospitals treatment patients research laboratory scientists discovered observations telescope galaxies'.split(' ')
  const material = Array.from({ length: 4 }, () => VOCAB.join(' ')).join('. ') + '.'
  const W = ['salmon', 'vaccine', 'glacier', 'telescope', 'library', 'orchard', 'reef', 'solar', 'wetland', 'clinic', 'satellite', 'school', 'forest', 'harvest', 'bridge', 'garden', 'coral', 'battery', 'seedling', 'observatory']
  // Indexed by GDELT a few minutes ago: every one of them looks brand new unless its real date is read.
  const pool: Candidate[] = Array.from({ length: 30 }, (_, i) => ({
    id: `c${i + 1}`, title: `${W[i % W.length]} ${W[(i * 7 + 3) % W.length]} ${W[(i * 11 + 5) % W.length]} ${W[(i * 13 + 1) % W.length]} unique${i}`,
    url: `https://www.bbc.co.uk/news/articles/${i + 1}`, sourceName: 'BBC News', publishedAt: null, discoveredAt: '2026-11-16T14:50:00Z', excerpt: '', via: 'GDELT', trust: 1,
  }))
  const ai: AiClient = {
    async json(req) {
      const ids = [...req.user.matchAll(/"id":"(c\d+)"/g)].map((m) => m[1])
      if (req.name === 'screening') return { evaluations: ids.map((id) => ({ id, is_good_news: true, category: 'nature', significance: 4, credibility: 4, reason: 'ok' })) } as never
      const heads = ['Volunteers restored the wetland habitat along the river', 'Schools and libraries gathered new funding for students', 'Clinics and nurses reached patients with vaccines', 'Scientists discovered native grasses recovering across landscapes', 'Villagers protected wildlife in the new sanctuary landscape', 'Teachers planted seedlings in nurseries near neighbours']
      const sentence = Array.from({ length: 70 }, (_, i) => VOCAB[i % VOCAB.length]).join(' ')
      return { stories: ids.slice(0, 6).map((id, i) => ({ id, role: i < 5 ? 'primary' : 'backup', category: 'nature', headline: heads[i], summary: sentence, why_good_news: 'why', preliminary: false, claims_to_check: ['c'], image_query: 'x', about_specific_person: false })) } as never
    },
  }
  const run = (published: (n: number) => string | null) =>
    runPipeline({ ai, today: '2026-11-16', now: new Date(NOW), discover: async () => pool, fetchMaterial: async (url) => ({ siteName: null, description: null, images: [], text: material, publishedRaw: published(Number(url.split('/').pop())) }) })

  it('drops articles whose own date is old, whatever the index says', async () => {
    const result = await run((n) => (n <= 20 ? '2026-10-01T08:00:00Z' : '2026-11-16T09:00:00-05:00'))
    expect(result.stats.staleByPublication).toBeGreaterThan(0)
    const old = result.stories.filter((s) => Number(s.source_url.split('/').pop()) <= 20)
    expect(old).toEqual([])
  })
  it('stores the article’s own date and the day it prints, not the index time', async () => {
    const result = await run(() => '2026-11-15T22:51:01-05:00')
    const s = result.stories.find((x) => x.role === 'primary')!
    expect(s.source_published_at).toBe('2026-11-16T03:51:01.000Z')
    expect(s.source_published_on).toBe('2026-11-15')
  })
  it('keeps an article with no declared date undated, so the freshness gate rejects it', async () => {
    const result = await run(() => null)
    expect(result.stories.filter((s) => s.role === 'primary')).toEqual([])
  })
})
