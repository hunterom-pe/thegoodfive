import { describe, expect, it, vi } from 'vitest'
import { extractImages } from './article.ts'
import { imagePlans, type WrittenStory } from './curate.ts'
import { attachImages, originalCandidate } from './images.ts'
import { parseFeed } from './rss.ts'
import type { Candidate, DraftStory } from './types.ts'
import { rankPhotos, toCandidate, withUtm, type UnsplashPhoto } from './unsplash.ts'

const photo = (id: string, alt: string | null, over: Partial<UnsplashPhoto> = {}): UnsplashPhoto => ({
  id, width: 4000, height: 2600, alt_description: alt, description: null,
  urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=abc&ixlib=rb-4`, regular: 'x' },
  links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc` },
  user: { name: `Photographer ${id}`, links: { html: `https://unsplash.com/@p${id}` } }, ...over,
})
const story = (n: number): DraftStory => ({ role: 'primary', position: n, category: 'nature', headline: `H${n}`, summary: 'S', source_name: 'Paper', source_url: `https://example.org/${n}`, source_published_at: null, original_title: 'T', original_excerpt: 'E', discovered_via: 'RSS', ai_rationale: 'r', claims_to_check: [] })
const cand = (n: number, over: Partial<Candidate> = {}): Candidate => ({ id: `c${n}`, title: 'T', url: `https://example.org/${n}`, sourceName: 'Paper', publishedAt: null, excerpt: '', via: 'RSS', trust: 2, ...over })
const sources = (n: number, hints = [{ url: 'https://example.org/lead.jpg', source: 'og:image' as const }]) => new Map([[`https://example.org/${n}`, { candidate: cand(n), hints }]])

describe('finding the article’s own image', () => {
  const html = `<html><head>
    <meta property="og:image" content="/img/lead.jpg?w=1200&amp;h=630">
    <meta name="twitter:image" content="https://cdn.example.org/tw.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","image":[{"@type":"ImageObject","url":"https://cdn.example.org/ld.jpg"},"https://cdn.example.org/tw.jpg"]},{"@type":"Organization","image":"https://cdn.example.org/logo.png"}]}</script>
    <script type="application/ld+json">{ broken json </script></head></html>`
  it('reads Open Graph, Twitter card and JSON-LD, resolves relative links and ignores non-article nodes', () => {
    const images = extractImages(html, 'https://www.example.org/news/story')
    expect(images.map((i) => `${i.source} ${i.url}`)).toEqual([
      'og:image https://www.example.org/img/lead.jpg?w=1200&h=630',
      'twitter:image https://cdn.example.org/tw.jpg',
      'json-ld https://cdn.example.org/ld.jpg',
    ])
  })
  it('rejects non-web image links', () => {
    expect(extractImages('<meta property="og:image" content="javascript:alert(1)"><meta name="twitter:image" content="data:image/png;base64,AAA">', 'https://e.org/')).toEqual([])
  })
  it('reads the image from RSS media fields and enclosures', () => {
    const xml = `<rss><channel>
      <item><title>A</title><link>https://e.org/a</link><media:content url="https://e.org/a.jpg" medium="image"/></item>
      <item><title>B</title><link>https://e.org/b</link><enclosure url="https://e.org/b.png" type="image/png" length="1"/></item>
      <item><title>C</title><link>https://e.org/c</link><enclosure url="https://e.org/c.mp3" type="audio/mpeg"/></item></channel></rss>`
    expect(parseFeed(xml, { name: 'T', url: 'u', trust: 2 }).map((i) => i.imageUrl)).toEqual(['https://e.org/a.jpg', 'https://e.org/b.png', null])
  })
})

describe('choosing a licensed photo', () => {
  it('never picks portraits or text-heavy images, and avoids all people for a story about one person', () => {
    const photos = [photo('1', 'portrait of a smiling woman'), photo('2', 'a sign with text on a wall'), photo('3', 'children playing in a garden'), photo('4', 'microscope in a laboratory')]
    expect(rankPhotos(photos, 'laboratory microscope', { aboutPerson: false }).map((p) => p.id)).toEqual(['4'])
    expect(rankPhotos(photos, 'laboratory microscope', { aboutPerson: true }).map((p) => p.id)).toEqual(['4'])
  })
  it('refuses a photo that shares nothing with the story subject, rather than settle for a loosely related one', () => {
    const photos = [photo('1', 'desktop monitor beside computer tower'), photo('2', null)]
    expect(rankPhotos(photos, 'pediatric hospital medical research', { aboutPerson: true })).toEqual([])
  })
  it('prefers the photo that matches the story subject and skips photos already used', () => {
    const photos = [photo('1', 'a mountain lake'), photo('2', 'coral reef with tropical fish underwater'), photo('3', 'reef fish')]
    expect(rankPhotos(photos, 'coral reef fish underwater', { aboutPerson: false })[0].id).toBe('2')
    expect(rankPhotos(photos, 'coral reef fish underwater', { aboutPerson: false, exclude: new Set(['2']) })[0].id).toBe('3')
  })
  it('credits the photographer and Unsplash with tagged links, keeping the hotlink URL as returned', () => {
    const c = toCandidate(photo('9', 'a reef'), 'thegoodfive', 'coral reef')
    expect(c).toMatchObject({ kind: 'illustrative', source: 'unsplash', license: 'Unsplash License', credit: 'Photographer 9', url: 'https://images.unsplash.com/photo-9?ixid=abc&ixlib=rb-4' })
    expect(c.creditUrl).toBe('https://unsplash.com/@p9?utm_source=thegoodfive&utm_medium=referral')
    expect(c.sourceUrl).toBe('https://unsplash.com/photos/9?utm_source=thegoodfive&utm_medium=referral')
    expect(withUtm('https://unsplash.com/', 'thegoodfive')).toBe('https://unsplash.com/?utm_source=thegoodfive&utm_medium=referral')
  })
})

describe('attaching images to a draft', () => {
  const plan = new Map([['https://example.org/1', { query: 'coral reef', aboutPerson: false }]])
  it('selects and clears a licensed photo, and keeps the publisher image as an UNAPPROVED candidate', async () => {
    const download = vi.fn(async () => true)
    const [out] = await attachImages([story(1)], sources(1), plan, { unsplashKey: 'k', search: async () => [photo('2', 'coral reef fish')], download })
    expect(out).toMatchObject({ image_kind: 'illustrative', image_source: 'unsplash', image_rights_confirmed: true, image_license: 'Unsplash License' })
    const kinds = out.image_candidates!.map((c) => `${c.kind}:${c.source}`)
    expect(kinds).toEqual(['original:og:image', 'illustrative:unsplash'])
    expect(out.image_candidates![0].license).toBeNull()
    expect(download).toHaveBeenCalledWith('https://api.unsplash.com/photos/2/download?ixid=abc')
  })
  it('does not notify Unsplash during a dry run', async () => {
    const download = vi.fn(async () => true)
    const [out] = await attachImages([story(1)], sources(1), plan, { search: async () => [photo('2', 'coral reef fish')], download, notify: false })
    expect(out.image_rights_confirmed).toBe(true)
    expect(download).not.toHaveBeenCalled()
  })
  it('selects the publisher image but leaves it NOT APPROVED when no licensed photo exists', async () => {
    const [none] = await attachImages([story(1)], sources(1), plan, { search: async () => [] })
    expect(none).toMatchObject({ image_kind: 'original', image_source: 'og:image', image_rights_confirmed: false, image_credit: 'Paper' })
    const [noKey] = await attachImages([story(1)], sources(1), plan, {})
    expect(noKey.image_rights_confirmed).toBe(false)
    expect(noKey.image_url).toBe('https://example.org/lead.jpg')
  })
  it('leaves the story on the geometric fallback when there is no image at all, and survives a failed search', async () => {
    const [out] = await attachImages([story(1)], sources(1, []), plan, { search: async () => { throw new Error('rate limited') }, log: () => {} })
    expect(out).toMatchObject({ image_url: null, image_rights_confirmed: false, image_candidates: [] })
  })
  it('never uses the same photo twice in one edition', async () => {
    const plans = new Map([['https://example.org/1', { query: 'reef', aboutPerson: false }], ['https://example.org/2', { query: 'reef', aboutPerson: false }]])
    const src = new Map([...sources(1, []), ...sources(2, [])])
    const out = await attachImages([story(1), story(2)], src, plans, { unsplashKey: 'k', search: async () => [photo('1', 'reef'), photo('2', 'reef')], download: async () => true })
    expect(out[0].image_url).not.toBe(out[1].image_url)
  })
  it('turns the writer’s search terms into clean queries and flags stories about a person', () => {
    const written = [{ id: 'c1', image_query: '  “coral reef” <b>fish</b>!! ', about_specific_person: true }] as unknown as WrittenStory[]
    const plans = imagePlans(written, [{ candidate: cand(1), evaluation: {} as never, material: '' }])
    expect(plans.get('https://example.org/1')).toEqual({ query: 'coral reef b fish b', aboutPerson: true })
  })
  it('reports an original candidate with unknown rights', () => {
    expect(originalCandidate(cand(1, { imageUrl: 'https://e.org/f.jpg' }), [])).toMatchObject({ kind: 'original', source: 'rss', license: null })
    expect(originalCandidate(cand(1), [])).toBeNull()
  })
})

describe('scheduled runs and the photo library', () => {
  const lib = [{ id: 'L1', unsplashId: 'u1', url: 'https://images.unsplash.com/photo-u1?ixid=z', alt: 'Wild bees on a meadow', credit: 'Ada Lens', creditUrl: 'https://unsplash.com/@ada', sourceUrl: 'https://unsplash.com/photos/u1', downloadLocation: 'https://api.unsplash.com/photos/u1/download?ixid=z', categories: ['nature'], keywords: ['bees', 'meadow'], generic: false, showsPeople: false, lastUsedOn: null }]
  const bees = { ...story(1), headline: 'Wild bees return to a restored meadow', summary: 'Ecologists recorded 41 species of bee in the meadow.' }
  it('uses an editor-saved photo without searching, approved, illustrative and credited', async () => {
    const search = vi.fn(async () => [])
    const download = vi.fn(async () => true)
    const [out] = await attachImages([bees], sources(1), new Map(), { library: lib, today: '2026-11-16', search, download })
    expect(search).not.toHaveBeenCalled()
    expect(out).toMatchObject({ image_source: 'unsplash', image_kind: 'illustrative', image_rights_confirmed: true, image_library_id: 'L1', image_credit: 'Ada Lens' })
    expect(out.image_credit_url).toContain('utm_source=thegoodfive')
    expect(out.image_url).toContain('ixid=z')
    expect(download).toHaveBeenCalledWith('https://api.unsplash.com/photos/u1/download?ixid=z') // Unsplash is told the photo was used (an event notice, not a search)
  })
  it('never approves the publisher’s image: with no library match the story keeps only an unapproved candidate', async () => {
    const [out] = await attachImages([{ ...bees, category: 'health' }], sources(1), new Map(), { library: lib, today: '2026-11-16' })
    expect(out.image_rights_confirmed).toBe(false)
    expect(out.image_library_id).toBeNull()
  })
  it('gives no story a photo another story already has', async () => {
    const out = await attachImages([bees, { ...bees, position: 2, source_url: 'https://example.org/2' }], new Map([...sources(1), ...sources(2)]), new Map(), { library: lib, today: '2026-11-16' })
    expect(out.filter((s) => s.image_library_id === 'L1')).toHaveLength(1)
  })
})
