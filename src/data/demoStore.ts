import { addDays, todayISO } from '../lib/dates'
import type { EditionStatus, EditorEdition, EditorStory, NewStory, StoryPatch } from '../lib/types'
import { DEMO_EDITIONS, unsplash } from './demo'

/**
 * A tiny in-browser stand-in for the database, used only in demo mode.
 * Editor changes persist to localStorage so the whole workflow — edit,
 * reorder, publish, read — can be tried end to end without credentials.
 */
const KEY = 'the-good-five:demo:v1'

function build(today: string): EditorEdition[] {
  return DEMO_EDITIONS.map((edition) => {
    const date = addDays(today, edition.offset)
    const id = `demo-${date}`
    let primary = 0
    let backup = 0
    const stories: EditorStory[] = edition.stories.map((s, i) => {
      const role = s.role ?? 'primary'
      return {
        id: `${id}-${i + 1}`,
        editionId: id,
        role,
        position: role === 'primary' ? ++primary : ++backup,
        category: s.category,
        headline: s.headline,
        summary: s.summary,
        sourceName: s.source,
        sourceUrl: 'https://example.org/sample-story',
        sourcePublishedAt: addDays(date, -s.age),
        imageUrl: s.photo ? unsplash(s.photo.id) : null,
        imageAlt: s.photo?.alt ?? null,
        imageCredit: s.photo ? 'Unsplash' : null,
        imageLicense: s.photo ? 'Unsplash License' : null,
        imageRightsConfirmed: Boolean(s.photo),
        originalTitle: s.research?.originalTitle ?? null,
        originalExcerpt: s.research?.excerpt ?? null,
        discoveredVia: s.research ? 'Sample feed' : null,
        aiRationale: s.research?.rationale ?? null,
        claimsToCheck: s.research?.claims ?? [],
        rejectedReason: null,
      }
    })
    return {
      id,
      date,
      status: edition.status,
      publishedAt: edition.status === 'published' ? `${date}T07:00:00Z` : null,
      isDemo: true,
      stories,
    }
  })
}

interface Persisted {
  seededFor: string
  editions: EditorEdition[]
}

let cache: Persisted | null = null

function load(): Persisted {
  const today = todayISO()
  if (cache?.seededFor === today) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Persisted) : null
    // Demo dates are relative to today, so yesterday's saved state is discarded.
    if (parsed?.seededFor === today) return (cache = parsed)
  } catch {
    /* storage unavailable: fall through to a fresh, in-memory seed */
  }
  return (cache = { seededFor: today, editions: build(today) })
}

function save(state: Persisted) {
  cache = state
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* in-memory only */
  }
}

const LOCKED = 'This edition is published and locked. Unpublish it to make changes.'

function mutate(editionId: string, fn: (edition: EditorEdition) => EditorEdition) {
  const state = load()
  save({ ...state, editions: state.editions.map((e) => (e.id === editionId ? fn(structuredClone(e)) : e)) })
}

export const demoStore = {
  editions: () => load().editions,
  edition: (id: string) => load().editions.find((e) => e.id === id) ?? null,
  reset() {
    cache = null
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* nothing to clear */
    }
  },
  updateStory(editionId: string, storyId: string, patch: StoryPatch) {
    mutate(editionId, (e) => {
      if (e.status === 'published') throw new Error(LOCKED)
      return { ...e, stories: e.stories.map((s) => (s.id === storyId ? { ...s, ...patch } : s)) }
    })
  },
  createEdition(date: string): string {
    const state = load()
    if (state.editions.some((e) => e.date === date)) throw new Error('An edition for that date already exists.')
    const id = `demo-${date}`
    save({ ...state, editions: [...state.editions, { id, date, status: 'draft', publishedAt: null, isDemo: true, stories: [] }] })
    return id
  },
  addStory(editionId: string, input: NewStory) {
    mutate(editionId, (e) => {
      if (e.status === 'published') throw new Error(LOCKED)
      const same = e.stories.filter((s) => s.role === input.role)
      const position = Math.max(0, ...same.map((s) => s.position ?? 0)) + 1
      if (input.role === 'primary' && position > 5) throw new Error('The edition already has five stories. Add this one as a backup.')
      const story: EditorStory = {
        id: `${editionId}-${Date.now().toString(36)}-${e.stories.length}`,
        editionId,
        role: input.role,
        position,
        category: input.category,
        headline: input.headline.trim(),
        summary: input.summary.trim(),
        sourceName: input.sourceName.trim(),
        sourceUrl: input.sourceUrl.trim(),
        sourcePublishedAt: input.sourcePublishedAt,
        imageUrl: input.imageUrl,
        imageAlt: input.imageAlt,
        imageCredit: input.imageCredit,
        imageLicense: input.imageLicense,
        imageRightsConfirmed: Boolean(input.imageUrl) && input.imageRightsConfirmed,
        originalTitle: null,
        originalExcerpt: null,
        discoveredVia: 'Added by editor',
        aiRationale: null,
        claimsToCheck: [],
        rejectedReason: null,
      }
      return { ...e, stories: [...e.stories, story] }
    })
  },
  deleteStory(editionId: string, storyId: string) {
    mutate(editionId, (e) => {
      if (e.status === 'published') throw new Error(LOCKED)
      if (e.stories.find((s) => s.id === storyId)?.role !== 'rejected') throw new Error('Only rejected stories can be deleted.')
      return { ...e, stories: e.stories.filter((s) => s.id !== storyId) }
    })
  },
  setLineup(editionId: string, primary: string[], backup: string[], rejection?: { id: string; reason: string }) {
    mutate(editionId, (e) => ({
      ...e,
      stories: e.stories.map((s) => {
        const p = primary.indexOf(s.id)
        const b = backup.indexOf(s.id)
        if (p >= 0) return { ...s, role: 'primary', position: p + 1, rejectedReason: null }
        if (b >= 0) return { ...s, role: 'backup', position: b + 1, rejectedReason: null }
        return { ...s, role: 'rejected', position: null, rejectedReason: rejection?.id === s.id ? rejection.reason : s.rejectedReason }
      }),
    }))
  },
  setStatus(editionId: string, status: EditionStatus) {
    mutate(editionId, (e) => ({ ...e, status, publishedAt: status === 'published' ? new Date().toISOString() : null }))
  },
}
