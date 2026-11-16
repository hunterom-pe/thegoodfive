import { describe, expect, it } from 'vitest'
import { applyMeta, metaForPath, SITE, sitemapXml, statusForPath } from './meta'
import html from '../../index.html?raw'

const tag = (doc: string, re: RegExp) => re.exec(doc)?.[1]

describe('route metadata', () => {
  it('gives every public page its own self-referencing canonical address', () => {
    expect(metaForPath('/').canonical).toBe(`${SITE}/`)
    expect(metaForPath('/about').canonical).toBe(`${SITE}/about`)
    expect(metaForPath('/archive/').canonical).toBe(`${SITE}/archive`)
    expect(metaForPath('/edition/2026-11-14').canonical).toBe(`${SITE}/edition/2026-11-14`)
  })
  it('gives distinct titles and descriptions', () => {
    const all = ['/', '/about', '/archive', '/edition/2026-11-14'].map((p) => metaForPath(p))
    expect(new Set(all.map((m) => m.title)).size).toBe(4)
    expect(new Set(all.map((m) => m.description)).size).toBe(4)
  })
  it('describes an edition by its date and headlines, within a search snippet’s length', () => {
    const m = metaForPath('/edition/2026-11-14', { date: '2026-11-14', headlines: ['Rangers count record turtle nests', 'Salmon return to the restored Alder river', 'Mobile library van lends 9,000 books'] })
    expect(m.title).toBe('Saturday 14 November 2026 — The Good Five')
    expect(m.description).toContain('Rangers count record turtle nests')
    expect(m.description.length).toBeLessThanOrEqual(158)
  })
  it('keeps unknown routes, impossible dates and editions that do not exist out of the index', () => {
    expect(metaForPath('/nope').noindex).toBe(true)
    expect(metaForPath('/edition/2026-02-30').noindex).toBe(true)
    expect(metaForPath('/edition/2026-01-01', { date: '2026-01-01', exists: false }).noindex).toBe(true)
    expect(metaForPath('/edition/2026-11-14', { date: '2026-11-14', headlines: ['x'], exists: true }).noindex).toBe(false)
  })
})

describe('writing metadata into the page', () => {
  it('replaces the title, description, canonical and sharing tags', () => {
    const out = applyMeta(html, metaForPath('/about'))
    expect(tag(out, /<title>([^<]*)<\/title>/)).toBe('About — The Good Five')
    expect(tag(out, /<link rel="canonical" href="([^"]*)"/)).toBe(`${SITE}/about`)
    expect(tag(out, /property="og:url" content="([^"]*)"/)).toBe(`${SITE}/about`)
    expect(tag(out, /property="og:title" content="([^"]*)"/)).toBe('About The Good Five')
    expect(tag(out, /name="twitter:title" content="([^"]*)"/)).toBe('About The Good Five')
    expect(tag(out, /name="description"\s+content="([^"]*)"/)).toMatch(/How The Good Five works/)
    expect(tag(out, /property="og:description" content="([^"]*)"/)).toMatch(/How The Good Five works/)
    expect(out).not.toMatch(/robots/)
  })
  it('keeps the image tags and escapes quotes and angle brackets from headlines', () => {
    const out = applyMeta(html, metaForPath('/edition/2026-11-14', { date: '2026-11-14', headlines: ['A "quoted" <b>headline</b> & more'] }))
    expect(out).toContain('og:image" content="https://thegoodfive.netlify.app/og-image.png"')
    expect(out).toContain('&quot;quoted&quot; &lt;b&gt;headline&lt;/b&gt; &amp; more')
    expect(out).not.toContain('<b>headline')
  })
  it('adds noindex for pages that should not be indexed', () => {
    expect(applyMeta(html, metaForPath('/nope'))).toContain('<meta name="robots" content="noindex, follow" />')
  })
  it('the home page output matches the original tags', () => {
    expect(applyMeta(html, metaForPath('/'))).toContain(`<link rel="canonical" href="${SITE}/" />`)
  })
})

describe('special characters in metadata', () => {
  const tag = (doc: string, re: RegExp) => re.exec(doc)?.[1]
  const cases = [
    'Company raises $1 million for a new library',
    'Grant of $2 and $& and $` and $\' and $$ survives',
    'A "quoted" headline & an ampersand <b>tag</b>',
    'Café owners in São Paulo — 日本語 — emoji 🌱 too',
  ]
  for (const text of cases) {
    it(`keeps "${text.slice(0, 30)}" literal and the page valid`, () => {
      const out = applyMeta(html, { ...metaForPath('/about'), title: text, shareTitle: text, description: text })
      const escaped = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      expect(tag(out, /<title>([^<]*)<\/title>/)).toBe(escaped)
      expect(tag(out, /name="description"\s+content="([^"]*)"/)).toBe(escaped)
      expect(tag(out, /property="og:description" content="([^"]*)"/)).toBe(escaped)
      expect(tag(out, /name="twitter:title" content="([^"]*)"/)).toBe(escaped)
      // Exactly one of each tag: nothing was duplicated or spliced in.
      expect(out.match(/<meta\s+name="description"/g)).toHaveLength(1)
      expect(out.match(/<title>/g)).toHaveLength(1)
      expect(out.match(/property="og:title"/g)).toHaveLength(1)
    })
  }
  it('an edition description built from a money headline stays intact', () => {
    const out = applyMeta(html, metaForPath('/edition/2026-11-14', { date: '2026-11-14', headlines: ['Town raises $1 million for clean water', 'Second'] }))
    expect(tag(out, /name="description"\s+content="([^"]*)"/)).toContain('Town raises $1 million for clean water')
  })
})

describe('the saved-stories page', () => {
  it('has its own title and canonical address, and is kept out of search results (it is personal to each browser)', () => {
    const m = metaForPath('/saved')
    expect(m).toMatchObject({ title: 'Saved stories — The Good Five', canonical: `${SITE}/saved`, noindex: true })
    expect(applyMeta(html, m)).toContain('<meta name="robots" content="noindex, follow" />')
  })
})

describe('HTTP status and the sitemap', () => {
  it('answers 200 for real pages and the editor, 404 for made-up addresses and impossible dates', () => {
    for (const ok of ['/', '/about', '/archive/', '/saved', '/editor', '/editor/automation', '/edition/2026-11-13', '/edition/2099-01-01']) expect(statusForPath(ok), ok).toBe(200)
    for (const gone of ['/nope', '/about/team', '/edition', '/edition/not-a-date', '/edition/2026-02-30', '/edition/2026-11-13/extra']) expect(statusForPath(gone), gone).toBe(404)
  })
  it('answers 404 for an edition the database says does not exist, and 200 when it could not be asked', () => {
    expect(statusForPath('/edition/2026-11-12', { date: '2026-11-12', exists: false })).toBe(404)
    expect(statusForPath('/edition/2026-11-12', { date: '2026-11-12', exists: true })).toBe(200)
    expect(statusForPath('/edition/2026-11-12', null)).toBe(200)
  })
  it('lists the indexable pages and each published edition once, newest first, and nothing private', () => {
    const xml = sitemapXml(['2026-11-13', '2026-11-15', '2026-11-13', 'not-a-date', '2026-02-30'])
    expect(xml.startsWith('<?xml')).toBe(true)
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual(['https://thegoodfive.netlify.app/', 'https://thegoodfive.netlify.app/about', 'https://thegoodfive.netlify.app/archive', 'https://thegoodfive.netlify.app/edition/2026-11-15', 'https://thegoodfive.netlify.app/edition/2026-11-13'])
    expect(xml).not.toMatch(/saved|editor/)
    expect(xml).toContain('<loc>https://thegoodfive.netlify.app/edition/2026-11-15</loc><lastmod>2026-11-15</lastmod>')
  })
})
