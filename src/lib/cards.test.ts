import { describe, expect, it, vi } from 'vitest'
import { canvasToPng, coverLayout, fitText, hashString, imageFilename, shareImageFile, wrapText, type Measure } from './cards'
import { attachFollowUps, followUpsFor, type FollowUpRow } from './followups'
import { storyUrl } from './reader'

/** A stand-in for canvas text measurement: each character about half the font size wide, wide glyphs a full size. */
const measure: Measure = (text, size) => Array.from(text).reduce((w, c) => w + (/[　-鿿\u{1F300}-\u{1FAFF}]/u.test(c) ? size : c === ' ' ? size * 0.28 : size * 0.52), 0)
const fits = (lines: string[], size: number, width: number) => lines.every((l) => measure(l, size) <= width + 0.01)

describe('headline layout on share cards', () => {
  const box = { width: 920, height: 520 }
  const opts = { maxSize: 88, minSize: 46, leading: 1.08 }

  it('keeps a short headline large', () => {
    const f = fitText('Wild bees return to a restored meadow', box, opts, measure)
    expect(f.size).toBe(88)
    expect(f.truncated).toBe(false)
  })
  it('shrinks the longest headline the gates allow (110 characters) to fit, without going below the readable minimum', () => {
    const long = 'Community-owned solar field in the Marrow Creek valley now supplies every home, school and fire station by day'
    expect(long.length).toBeGreaterThanOrEqual(105)
    const f = fitText(long, box, opts, measure)
    expect(f.truncated).toBe(false)
    expect(f.size).toBeGreaterThanOrEqual(46)
    expect(fits(f.lines, f.size, box.width)).toBe(true)
    expect(f.lines.length * f.lineHeight).toBeLessThanOrEqual(box.height)
    expect(f.lines.join(' ')).toBe(long)
  })
  it('never lets one very long word run off the card', () => {
    const lines = wrapText('Supercalifragilisticexpialidociousness'.repeat(4), 400, 60, measure)
    expect(lines.length).toBeGreaterThan(1)
    expect(fits(lines, 60, 400)).toBe(true)
  })
  it('keeps punctuation, quotes, accents, CJK and emoji whole', () => {
    const text = '“Café” owners in São Paulo — 日本語のニュース 🌱🌍 — say it’s working!'
    const f = fitText(text, box, opts, measure)
    expect(f.lines.join(' ')).toBe(text)
    expect(fits(f.lines, f.size, box.width)).toBe(true)
  })
  it('shortens only text that cannot fit even at the minimum size, with an ellipsis, never mid-character', () => {
    const f = fitText('word '.repeat(400).trim(), { width: 300, height: 120 }, { maxSize: 40, minSize: 30, leading: 1.2 }, measure)
    expect(f.truncated).toBe(true)
    expect(f.size).toBe(30)
    expect(f.lines.at(-1)).toMatch(/…$/)
    expect(fits(f.lines, f.size, 300)).toBe(true)
    const emoji = fitText('🌱'.repeat(200), { width: 200, height: 60 }, { maxSize: 40, minSize: 40, leading: 1.2 }, measure)
    expect(emoji.lines.at(-1)).toMatch(/^(🌱)+…$/u)
  })
})

describe('edition covers', () => {
  const cats = ['nature', 'science', 'health', 'progress', 'humanity'] as const
  it('is the same for the same edition, every time, on every device', () => {
    expect(coverLayout('2026-11-14', [...cats])).toEqual(coverLayout('2026-11-14', [...cats]))
    expect(hashString('2026-11-14')).toBe(hashString('2026-11-14'))
  })
  it('differs between editions', () => {
    const days = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-12-25']
    const layouts = new Set(days.map((d) => JSON.stringify(coverLayout(d, [...cats]).map((s) => [s.x, s.y, s.size]))))
    expect(layouts.size).toBe(days.length)
  })
  it('has five squares, one per story, inside the frame and never overlapping, across four years of dates', () => {
    for (let i = 0; i < 1461; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
      const sq = coverLayout(date, [...cats])
      expect(sq.map((s) => s.story)).toEqual([1, 2, 3, 4, 5])
      for (const s of sq) {
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.y).toBeGreaterThanOrEqual(0)
        expect(s.x + s.size).toBeLessThanOrEqual(100)
        expect(s.y + s.size).toBeLessThanOrEqual(100)
      }
      for (let a = 0; a < 5; a++)
        for (let b = a + 1; b < 5; b++) {
          const A = sq[a]
          const B = sq[b]
          expect(A.x < B.x + B.size && B.x < A.x + A.size && A.y < B.y + B.size && B.y < A.y + A.size, `${date} ${a}/${b}`).toBe(false)
        }
    }
  })
  it('colours each square by its story’s category, and the lead story’s square is the largest', () => {
    const sq = coverLayout('2026-11-14', ['health', 'nature', 'nature', 'nature', 'nature'])
    expect(sq[0].color).toBe('#ebc9cc')
    expect(sq[0].size).toBeGreaterThan(sq[4].size)
  })
})

describe('exporting and sharing images', () => {
  it('rejects with a plain message when the browser cannot produce the image', async () => {
    await expect(canvasToPng({ toBlob: (cb: BlobCallback) => cb(null) } as never)).rejects.toThrow(/could not create the image/)
    await expect(canvasToPng({ toBlob: () => { throw new Error('SecurityError') } } as never)).rejects.toThrow(/could not create the image/)
    await expect(canvasToPng({ toBlob: (cb: BlobCallback) => cb(new Blob([])) } as never)).rejects.toThrow()
    const png = new Blob(['x'], { type: 'image/png' })
    await expect(canvasToPng({ toBlob: (cb: BlobCallback) => cb(png) } as never)).resolves.toBe(png)
  })
  const blob = new Blob(['png'], { type: 'image/png' })
  const data = { title: 'A story — The Good Five', url: storyUrl('2026-11-14', 2) }
  it('shares the image file where the device supports it, with the story’s dated link', async () => {
    const share = vi.fn(async () => {})
    expect(await shareImageFile(blob, 'x.png', data, { share, canShare: () => true })).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://thegoodfive.netlify.app/edition/2026-11-14#story-2', title: data.title }))
  })
  it('falls back (caller downloads) where file sharing is missing or refused, and treats closing the sheet as a cancel', async () => {
    expect(await shareImageFile(blob, 'x.png', data, {})).toBe('unsupported')
    expect(await shareImageFile(blob, 'x.png', data, { share: async () => {}, canShare: () => false })).toBe('unsupported')
    expect(await shareImageFile(blob, 'x.png', data, { share: async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }) }, canShare: () => true })).toBe('cancelled')
    expect(await shareImageFile(blob, 'x.png', data, { share: async () => { throw new Error('NotAllowedError') }, canShare: () => true })).toBe('failed')
  })
  it('names files safely, whatever the headline contains', () => {
    expect(imageFilename('story', '2026-11-14', 'Café owners “win” in São Paulo! 🌱')).toBe('the-good-five-2026-11-14-cafe-owners-win-in-sao-paulo.png')
    expect(imageFilename('story', '2026-11-14', '日本語')).toBe('the-good-five-2026-11-14-story.png')
    expect(imageFilename('edition', '2026-11-14')).toBe('the-good-five-2026-11-14-edition.png')
  })
  it('links an archived story to its own edition date, not today', () => {
    expect(storyUrl('2026-11-13', 5)).toBe('https://thegoodfive.netlify.app/edition/2026-11-13#story-5')
  })
})

describe('follow-up links for readers', () => {
  const row = (over: Partial<FollowUpRow> = {}): FollowUpRow => ({
    id: 'f1', explanation: 'The sanctuary was extended.', source_url: 'https://example.org/x',
    earlier_story_id: 'old', earlier_date: '2026-11-10', earlier_position: 1, earlier_headline: 'Atolls declared sanctuaries',
    later_story_id: 'new', later_date: '2026-11-14', later_position: 3, later_headline: 'Sanctuary extended', ...over,
  })
  it('shows "An update to" on the newer story and "What happened next?" on the earlier one, linking to the other’s dated story', () => {
    expect(followUpsFor('new', [row()])).toEqual([expect.objectContaining({ kind: 'update-to', date: '2026-11-10', position: 1, headline: 'Atolls declared sanctuaries' })])
    expect(followUpsFor('old', [row()])).toEqual([expect.objectContaining({ kind: 'what-next', date: '2026-11-14', position: 3, headline: 'Sanctuary extended' })])
    expect(followUpsFor('other', [row()])).toEqual([])
  })
  it('drops malformed rows: backwards in time, same day, self-links, bad positions, unsafe sources, duplicates', () => {
    const bad = [
      row({ id: 'a', earlier_date: '2026-11-15' }),
      row({ id: 'b', earlier_date: '2026-11-14' }),
      row({ id: 'c', earlier_story_id: 'new' }),
      row({ id: 'd', later_position: 9 }),
      row({ id: 'e', source_url: 'javascript:alert(1)' }),
    ]
    expect(followUpsFor('new', bad)).toEqual([])
    expect(followUpsFor('new', [row(), row()])).toHaveLength(1)
  })
  it('never adds stories: an edition keeps exactly its five', () => {
    const stories = [1, 2, 3, 4, 5].map((p) => ({ id: p === 3 ? 'new' : `s${p}`, position: p }) as never)
    const out = attachFollowUps(stories, [row()])
    expect(out).toHaveLength(5)
    expect(out[2]).toMatchObject({ followUps: [expect.objectContaining({ kind: 'update-to' })] })
    expect(out[0]).not.toHaveProperty('followUps')
  })
})
