import { describe, expect, it } from 'vitest'
import { applyMeta, metaForPath, SITE } from './meta'
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
