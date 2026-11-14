import { describe, expect, it } from 'vitest'
import { sizedImage } from '../components/StoryParts'
import { ARCHIVE_PAGE_SIZE, editionAsPublic, paginateArchive } from '../data/publicRepo'
import { candidatePatch } from '../editor/PhotoPanel'
import type { EditionSummary, EditorEdition, EditorStory, ImageCandidate } from './types'

const story = (position: number, over: Partial<EditorStory> = {}): EditorStory => ({
  id: `s${position}`, editionId: 'e', role: 'primary', position, category: 'nature', headline: `H${position}`, summary: 'S', sourceName: 'Paper', sourceUrl: 'https://e.org/a',
  sourcePublishedAt: null, imageUrl: null, imageAlt: null, imageCredit: null, imageLicense: null, imageKind: null, imageSource: null, imageSourceUrl: null, imageCreditUrl: null,
  imageCandidates: [], imageRightsConfirmed: false, originalTitle: null, originalExcerpt: null, discoveredVia: null, aiRationale: null, claimsToCheck: [], rejectedReason: null, ...over,
})
const edition = (stories: EditorStory[]): EditorEdition => ({ id: 'e', date: '2026-11-13', status: 'published', publishedAt: '2026-11-13T07:00:00Z', isDemo: false, stories })

describe('approval gate: what readers receive', () => {
  const img = { imageUrl: 'https://cdn.example.org/lead.jpg', imageAlt: 'alt', imageCredit: 'Publisher', imageCreditUrl: 'https://e.org', imageLicense: 'CC', imageKind: 'original' as const, imageSourceUrl: 'https://e.org/a' }
  it('withholds an unapproved image and every detail about it', () => {
    const [s] = editionAsPublic(edition([story(1, { ...img, imageRightsConfirmed: false })])).stories
    expect(s).toMatchObject({ imageUrl: null, imageAlt: null, imageCredit: null, imageKind: null, imageLicense: null, imageSourceUrl: null, imageCreditUrl: null })
  })
  it('passes an approved image with its attribution', () => {
    const [s] = editionAsPublic(edition([story(1, { ...img, imageRightsConfirmed: true })])).stories
    expect(s).toMatchObject({ imageUrl: img.imageUrl, imageKind: 'original', imageCredit: 'Publisher', imageCreditUrl: 'https://e.org' })
  })
  it('never exposes backups, rejected stories, candidates or review notes', () => {
    const e = edition([story(1, { imageCandidates: [{ url: 'https://x/y.jpg' } as ImageCandidate], aiRationale: 'secret' }), story(2, { role: 'backup' }), story(3, { role: 'rejected', position: null })])
    const pub = editionAsPublic(e)
    expect(pub.stories).toHaveLength(1)
    expect(JSON.stringify(pub)).not.toMatch(/secret|x\/y\.jpg|imageCandidates|aiRationale/)
  })
})

describe('choosing a candidate in the editor', () => {
  const base = { alt: 'a', credit: 'C', creditUrl: 'https://c', license: 'L', sourceUrl: 'https://s' }
  it('clears a licensed Unsplash photo but never a publisher image', () => {
    expect(candidatePatch({ ...base, url: 'https://images.unsplash.com/p', kind: 'illustrative', source: 'unsplash' }).imageRightsConfirmed).toBe(true)
    for (const source of ['og:image', 'twitter:image', 'json-ld', 'rss']) expect(candidatePatch({ ...base, url: 'https://pub/x.jpg', kind: 'original', source }).imageRightsConfirmed).toBe(false)
  })
})

describe('image sizing', () => {
  it('sizes Unsplash links and keeps ixid, which Unsplash requires', () => {
    const out = new URL(sizedImage('https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4', 800))
    expect(out.searchParams.get('w')).toBe('800')
    expect(out.searchParams.get('ixid')).toBe('abc')
    expect(out.searchParams.get('auto')).toBe('format')
  })
  it('leaves other hosts and bad URLs alone', () => {
    expect(sizedImage('https://cdn.example.org/a.jpg', 800)).toBe('https://cdn.example.org/a.jpg')
    expect(sizedImage('not a url', 800)).toBe('not a url')
  })
})

describe('archive paging', () => {
  const all: EditionSummary[] = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, date: new Date(Date.UTC(2026, 10, 30) - i * 86400000).toISOString().slice(0, 10), isDemo: false, stories: [] }))
  it('walks the whole archive newest first, one page at a time, with no gaps or repeats', () => {
    const seen: string[] = []
    let cursor: string | null | undefined
    let pages = 0
    do {
      const page = paginateArchive(all, cursor)
      expect(page.items.length).toBeLessThanOrEqual(ARCHIVE_PAGE_SIZE)
      seen.push(...page.items.map((e) => e.date))
      cursor = page.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toEqual(all.map((e) => e.date))
  })
  it('reports no next page when everything fits', () => {
    expect(paginateArchive(all.slice(0, 10), null).nextCursor).toBeNull()
    expect(paginateArchive([], null)).toEqual({ items: [], nextCursor: null })
  })
})
