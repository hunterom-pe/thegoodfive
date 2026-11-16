import { describe, expect, it, vi } from 'vitest'
import { createLocalStore, type KeyValueStorage } from './localStore'
import { measurePosition, scrollTargetFor } from './readingPosition'
import {
  dismissProgress,
  makeReaderStores,
  MAX_EDITIONS,
  parseFavorites,
  parseProgress,
  parseSaved,
  recordProgress,
  resumeOffer,
  sortSaved,
  storyPath,
  storyUrl,
  toggleSaved,
  type ProgressMap,
} from './reader'

/** An in-memory stand-in for localStorage that can be told to fail. */
function memoryStorage(fail: { get?: boolean; set?: boolean } = {}) {
  const data = new Map<string, string>()
  const s: KeyValueStorage & { data: Map<string, string> } = {
    data,
    getItem: (k) => {
      if (fail.get) throw new Error('SecurityError')
      return data.has(k) ? data.get(k)! : null
    },
    setItem: (k, v) => {
      if (fail.set) throw new Error('QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k) => void data.delete(k),
  }
  return s
}

const story = { id: 'a1', date: '2026-11-15', position: 2, headline: 'Wild bees return', sourceName: 'BBC News', category: 'nature' }

describe('saved stories', () => {
  it('saves, unsaves and keeps one entry per story', () => {
    let list = toggleSaved([], story, new Date('2026-11-15T10:00:00Z'))
    expect(list).toEqual([{ ...story, savedAt: '2026-11-15T10:00:00.000Z' }])
    list = toggleSaved(list, story)
    expect(list).toEqual([])
  })
  it('links to the dated edition and the story anchor, also as a full share link', () => {
    expect(storyPath('2026-11-14', 3)).toBe('/edition/2026-11-14#story-3')
    expect(storyUrl('2026-11-14', 3)).toBe('https://thegoodfive.netlify.app/edition/2026-11-14#story-3')
  })
  it('lists newest edition first, then in story order', () => {
    const list = [
      { ...story, id: 'x', date: '2026-11-13', position: 1, savedAt: '' },
      { ...story, id: 'y', date: '2026-11-15', position: 4, savedAt: '' },
      { ...story, id: 'z', date: '2026-11-15', position: 1, savedAt: '' },
    ]
    expect(sortSaved(list).map((s) => s.id)).toEqual(['z', 'y', 'x'])
  })
  it('discards anything that is not a valid saved story: wrong types, bad dates or slots, duplicates', () => {
    const raw = [
      { ...story, savedAt: '2026-11-15T10:00:00Z' },
      { ...story }, // duplicate id
      { ...story, id: 'b', date: 'yesterday' },
      { ...story, id: 'c', position: 9 },
      { ...story, id: 'd', headline: '   ' },
      { ...story, id: 'e', position: 2.5 },
      null,
      42,
      'story',
      [],
    ]
    expect(parseSaved(raw).map((s) => s.id)).toEqual(['a1'])
    for (const junk of [undefined, null, 'x', 5, {}, { a: 1 }]) expect(parseSaved(junk)).toEqual([])
  })
})

describe('reading progress', () => {
  const T = (s: string) => new Date(`2026-11-15T${s}Z`)
  it('records the story and how far into it, in coarse steps', () => {
    const map = recordProgress({}, '2026-11-15', { story: 3, fraction: 0.43, finished: false }, T('08:00:00'))
    expect(map['2026-11-15']).toMatchObject({ story: 3, fraction: 0.45, finished: false, dismissed: false })
  })
  it('returns the same map when nothing meaningful changed, so nothing is written', () => {
    const a = recordProgress({}, '2026-11-15', { story: 3, fraction: 0.4, finished: false })
    expect(recordProgress(a, '2026-11-15', { story: 3, fraction: 0.41, finished: false })).toBe(a)
  })
  it('offers to continue only this edition, never after an explicit anchor, a dismissal or the end', () => {
    let map: ProgressMap = recordProgress({}, '2026-11-14', { story: 4, fraction: 0.2, finished: false })
    expect(resumeOffer(map, '2026-11-15', '')).toBeNull() // yesterday's place does not follow you into today
    expect(resumeOffer(map, '2026-11-14', '')).toMatchObject({ story: 4 })
    expect(resumeOffer(map, '2026-11-14', '#story-2')).toBeNull() // the URL wins
    expect(resumeOffer(map, '2026-11-14', '#')).toMatchObject({ story: 4 }) // an empty fragment is no anchor
    expect(resumeOffer(dismissProgress(map, '2026-11-14'), '2026-11-14', '')).toBeNull()
    map = recordProgress(map, '2026-11-14', { story: 5, fraction: 1, finished: true })
    expect(resumeOffer(map, '2026-11-14', '')).toBeNull()
  })
  it('does not offer anything for a barely started edition', () => {
    expect(resumeOffer(recordProgress({}, '2026-11-15', { story: 1, fraction: 0.1, finished: false }), '2026-11-15', '')).toBeNull()
  })
  it('reading on after a dismissal makes the new place offerable again; a tiny scroll does not', () => {
    let map = dismissProgress(recordProgress({}, '2026-11-15', { story: 2, fraction: 0.5, finished: false }), '2026-11-15')
    expect(recordProgress(map, '2026-11-15', { story: 2, fraction: 0.55, finished: false })['2026-11-15'].dismissed).toBe(true)
    map = recordProgress(map, '2026-11-15', { story: 3, fraction: 0.2, finished: false })
    expect(map['2026-11-15'].dismissed).toBe(false)
  })
  it('finishing is remembered even if the reader scrolls back up', () => {
    let map = recordProgress({}, '2026-11-15', { story: 5, fraction: 1, finished: true })
    map = recordProgress(map, '2026-11-15', { story: 2, fraction: 0.3, finished: false })
    expect(map['2026-11-15'].finished).toBe(true)
  })
  it('remembers a limited number of editions, dropping the least recently read', () => {
    let map: ProgressMap = {}
    for (let d = 1; d <= MAX_EDITIONS + 5; d++) map = recordProgress(map, `2026-10-${String(d).padStart(2, '0')}`, { story: 2, fraction: 0.5, finished: false }, new Date(Date.UTC(2026, 9, d)))
    expect(Object.keys(map)).toHaveLength(MAX_EDITIONS)
    expect(map['2026-10-19']).toBeDefined()
    expect(map['2026-10-01']).toBeUndefined()
  })
  it('ignores corrupt or out-of-range stored progress', () => {
    const raw = { '2026-11-15': { story: 3, fraction: 0.5, updatedAt: 'x' }, '2026-11-14': { story: 7, fraction: 0.5 }, nope: { story: 2, fraction: 0.5 }, '2026-11-13': { story: 2, fraction: 'half' }, '2026-11-12': { story: 2, fraction: 9 } }
    const map = parseProgress(raw)
    expect(Object.keys(map).sort()).toEqual(['2026-11-12', '2026-11-15'])
    expect(map['2026-11-12'].fraction).toBe(1) // clamped
    for (const junk of [undefined, null, [], 'x', 3]) expect(parseProgress(junk)).toEqual({})
  })
})

describe('where the reader is', () => {
  const stories = [
    { n: 1, top: -1500, height: 1000 },
    { n: 2, top: -500, height: 1000 },
    { n: 3, top: 500, height: 1000 },
  ]
  it('is in the story at the reading line, with how far into it', () => {
    expect(measurePosition(stories, 3000, 1000)).toEqual({ story: 2, fraction: 0.95, finished: false })
  })
  it('is before the first story at the top of the page, and finished once the back cover shows', () => {
    expect(measurePosition([{ n: 1, top: 800, height: 900 }], 5000, 1000).story).toBe(0)
    expect(measurePosition(stories, 500, 1000).finished).toBe(true)
  })
})

describe('the one you took with you', () => {
  it('keeps one valid pick per edition and drops junk', () => {
    expect(parseFavorites({ '2026-11-15': 'abc', '2026-11-14': 7, bad: 'x', '2026-11-13': '' })).toEqual({ '2026-11-15': 'abc' })
    for (const junk of [undefined, null, [], 'x']) expect(parseFavorites(junk)).toEqual({})
  })
})

describe('storage that misbehaves', () => {
  it('works normally with storage, and survives a reload (a new store over the same storage)', () => {
    const storage = memoryStorage()
    makeReaderStores(storage).saved.set([{ ...story, savedAt: '2026-11-15T10:00:00Z' }])
    expect(makeReaderStores(storage).saved.get().map((s) => s.id)).toEqual(['a1'])
    expect(makeReaderStores(storage).saved.persistent()).toBe(true)
  })
  it('without storage (private mode): keeps saves for this visit only, and says so', () => {
    const { saved } = makeReaderStores(null)
    expect(saved.persistent()).toBe(false)
    saved.set([{ ...story, savedAt: '' }])
    expect(saved.get()).toHaveLength(1)
  })
  it('a store that throws on write falls back to memory instead of breaking the page', () => {
    const { saved } = makeReaderStores(memoryStorage({ set: true }))
    expect(() => saved.set([{ ...story, savedAt: '' }])).not.toThrow()
    expect(saved.get()).toHaveLength(1)
    expect(saved.persistent()).toBe(false)
  })
  it('a store that throws on read starts empty', () => {
    expect(makeReaderStores(memoryStorage({ get: true })).saved.get()).toEqual([])
  })
  it('corrupt JSON reads as empty, and the next save repairs it', () => {
    const storage = memoryStorage()
    storage.data.set('goodfive:saved:v1', '{not json')
    const { saved } = makeReaderStores(storage)
    expect(saved.get()).toEqual([])
    saved.set([{ ...story, savedAt: '' }])
    expect(JSON.parse(storage.data.get('goodfive:saved:v1')!)).toHaveLength(1)
  })
  it('gives React the same value until something changes, and tells subscribers when it does', () => {
    const store = createLocalStore('k', (raw) => (Array.isArray(raw) ? raw : []), memoryStorage())
    expect(store.get()).toBe(store.get())
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.set([1])
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    store.set([2])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

// ── restoring the reading position ───────────────────────────────────
describe('restoring where the reader was', () => {
  // Five stories of unequal height laid out down a page; the header leaves 72px.
  const heights = [900, 1100, 1000, 1300, 1050]
  const tops = heights.map((_, i) => 400 + heights.slice(0, i).reduce((a, b) => a + b, 0))
  const view = (scrollY: number) => heights.map((h, i) => ({ n: i + 1, top: tops[i] - scrollY, height: h }))
  it('returns to the same story and place for every story, fraction and screen height', () => {
    for (const vh of [568, 700, 844, 932]) {
      for (let n = 1; n <= 5; n++) {
        for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
          const s = { top: tops[n - 1], height: heights[n - 1] }
          const y = scrollTargetFor(s, fraction, 0, vh, 72)
          const got = measurePosition(view(y), null, vh)
          expect(got.story, `story ${n} at ${fraction}, ${vh}px`).toBe(n)
          // Near a story's start the story is shown from its top (just under the header): same story, never an earlier one.
          expect(got.fraction).toBeGreaterThanOrEqual(fraction - 0.02)
          if (fraction >= 0.3) expect(Math.abs(got.fraction - fraction)).toBeLessThan(0.02)
        }
      }
    }
  })
  it('does not land in the next story from the end of one', () => {
    const y = scrollTargetFor({ top: tops[2], height: heights[2] }, 0.95, 0, 844, 72)
    expect(measurePosition(view(y), null, 844).story).toBe(3)
  })
})
