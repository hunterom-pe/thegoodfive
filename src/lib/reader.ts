import { useSyncExternalStore } from 'react'
import { asRecord, createLocalStore, isISODateString, type KeyValueStorage, type LocalStore } from './localStore'
import { SITE } from './meta'

/**
 * Everything a reader keeps on this device: the stories they saved, where they were in each edition, and the
 * one story they took with them from each edition. Pure functions plus thin React hooks, so the rules are
 * unit-tested without a browser. Nothing here leaves the browser.
 */

// ── Saved stories ─────────────────────────────────────────────────────
export interface SavedStory {
  /** The story's stable id. */
  id: string
  /** The edition it ran in (YYYY-MM-DD) and its slot, which together make its permanent address. */
  date: string
  position: number
  /** Just enough to list it without a network request. */
  headline: string
  sourceName: string
  category: string
  savedAt: string
}

export const MAX_SAVED = 300

export function parseSaved(raw: unknown): SavedStory[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SavedStory[] = []
  for (const item of raw) {
    const r = asRecord(item)
    if (!r) continue
    const { id, date, position, headline, sourceName, category, savedAt } = r
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    if (!isISODateString(date) || typeof position !== 'number' || !Number.isInteger(position) || position < 1 || position > 5) continue
    if (typeof headline !== 'string' || !headline.trim()) continue
    seen.add(id)
    out.push({
      id,
      date,
      position,
      headline: headline.slice(0, 300),
      sourceName: typeof sourceName === 'string' ? sourceName.slice(0, 120) : '',
      category: typeof category === 'string' ? category.slice(0, 40) : '',
      savedAt: typeof savedAt === 'string' && !Number.isNaN(Date.parse(savedAt)) ? savedAt : new Date(0).toISOString(),
    })
    if (out.length >= MAX_SAVED) break
  }
  return out
}

/** Newest edition first, then story order. */
export const sortSaved = (list: SavedStory[]) => [...list].sort((a, b) => b.date.localeCompare(a.date) || a.position - b.position)

export function toggleSaved(list: SavedStory[], story: Omit<SavedStory, 'savedAt'>, now = new Date()): SavedStory[] {
  if (list.some((s) => s.id === story.id)) return list.filter((s) => s.id !== story.id)
  return [{ ...story, savedAt: now.toISOString() }, ...list].slice(0, MAX_SAVED)
}

/** The permanent, shareable address of a story: its dated edition and its anchor. */
export const storyPath = (date: string, position: number) => `/edition/${date}#story-${position}`
export const storyUrl = (date: string, position: number, origin = SITE) => `${origin}${storyPath(date, position)}`

// ── Reading progress ──────────────────────────────────────────────────
export interface Progress {
  /** The story the reader was in (1-5). */
  story: number
  /** How far through that story, 0 to 1: an anchor relative to the story, not a pixel offset of the page. */
  fraction: number
  /** They reached the closing page. */
  finished: boolean
  /** They closed the "Continue" offer for this edition. */
  dismissed: boolean
  updatedAt: string
}
export type ProgressMap = Record<string, Progress>

/** Editions remembered at most; older ones are forgotten. */
export const MAX_EDITIONS = 14

export function parseProgress(raw: unknown): ProgressMap {
  const r = asRecord(raw)
  if (!r) return {}
  const out: ProgressMap = {}
  for (const [date, value] of Object.entries(r)) {
    const p = asRecord(value)
    if (!isISODateString(date) || !p) continue
    const story = p.story
    const fraction = p.fraction
    if (typeof story !== 'number' || !Number.isInteger(story) || story < 1 || story > 5) continue
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) continue
    out[date] = {
      story,
      fraction: Math.min(1, Math.max(0, fraction)),
      finished: p.finished === true,
      dismissed: p.dismissed === true,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date(0).toISOString(),
    }
  }
  return pruneProgress(out)
}

/** Keep the most recently read editions only. */
export function pruneProgress(map: ProgressMap, keep = MAX_EDITIONS): ProgressMap {
  const dates = Object.keys(map).sort((a, b) => map[b].updatedAt.localeCompare(map[a].updatedAt) || b.localeCompare(a))
  return Object.fromEntries(dates.slice(0, keep).map((d) => [d, map[d]]))
}

/**
 * Record where the reader is. Returns the same map when nothing meaningful changed, so callers can skip a write.
 * Moving on in the edition clears an earlier "dismissed", so a later visit can offer the new place.
 */
export function recordProgress(map: ProgressMap, date: string, at: { story: number; fraction: number; finished: boolean }, now = new Date()): ProgressMap {
  const prev = map[date]
  const fraction = Math.round(Math.min(1, Math.max(0, at.fraction)) * 20) / 20 // 5% steps: fewer, meaningful writes
  const finished = at.finished || prev?.finished === true
  if (prev && prev.story === at.story && prev.fraction === fraction && prev.finished === finished) return map
  const movedOn = !prev || at.story !== prev.story || Math.abs(fraction - prev.fraction) >= 0.25
  return pruneProgress({ ...map, [date]: { story: at.story, fraction, finished, dismissed: movedOn ? false : prev.dismissed, updatedAt: now.toISOString() } })
}

export function dismissProgress(map: ProgressMap, date: string): ProgressMap {
  const prev = map[date]
  return prev ? { ...map, [date]: { ...prev, dismissed: true } } : map
}

/**
 * Should the page offer to continue? Only for THIS edition (yesterday's place never carries into today's),
 * never when the URL already points somewhere (#story-3 wins), never once they finished or dismissed it, and
 * not when they barely started. The offer is a button: the page never moves on its own.
 */
export function resumeOffer(map: ProgressMap, date: string, hash: string): Progress | null {
  if (hash && hash !== '#') return null
  const p = map[date]
  if (!p || p.finished || p.dismissed) return null
  if (p.story === 1 && p.fraction < 0.25) return null
  return p
}

// ── The one you took with you ─────────────────────────────────────────
/** Edition date → the id of the story the reader picked at the end. */
export type Favorites = Record<string, string>

export function parseFavorites(raw: unknown): Favorites {
  const r = asRecord(raw)
  if (!r) return {}
  const entries = Object.entries(r).filter((e): e is [string, string] => isISODateString(e[0]) && typeof e[1] === 'string' && e[1].length > 0 && e[1].length < 100)
  return Object.fromEntries(entries.sort(([a], [b]) => b.localeCompare(a)).slice(0, 60))
}

// ── Stores and hooks ──────────────────────────────────────────────────
export function makeReaderStores(storage?: KeyValueStorage | null) {
  return {
    saved: createLocalStore('goodfive:saved:v1', parseSaved, storage),
    progress: createLocalStore('goodfive:progress:v1', parseProgress, storage),
    favorites: createLocalStore('goodfive:favorite:v1', parseFavorites, storage),
  }
}

let stores: ReturnType<typeof makeReaderStores> | undefined
/** The browser's stores, created on first use (never during module import, so tests stay pure). */
export const readerStores = () => (stores ??= makeReaderStores())

export function useStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
