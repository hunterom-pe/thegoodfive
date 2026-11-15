import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { CATEGORIES } from '../lib/categories'
import { dismissProgress, readerStores, recordProgress, resumeOffer, toggleSaved, useStore, type Progress } from '../lib/reader'
import { storyScrollTarget, useReadingPosition } from '../lib/readingPosition'
import type { PublicEdition, PublicStory } from '../lib/types'
import { wrap } from './Brand'
import { two } from './StoryParts'

/**
 * Reader tools for one edition: save buttons, the mobile story strip, the desktop contents rail and the
 * "continue where you left off" offer. All state stays in this browser (src/lib/reader.ts).
 */
interface ReaderInfo {
  edition: PublicEdition
  /** False in the editor's preview: nothing is saved or remembered for a draft. */
  interactive: boolean
}
const ReaderContext = createContext<ReaderInfo | null>(null)
export const ReaderProvider = ReaderContext.Provider
export const useReader = () => useContext(ReaderContext)

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Scroll to a story (or a point in it), then give it keyboard focus without scrolling again. */
export function goToStory(n: number, fraction = 0) {
  const top = storyScrollTarget(n, fraction)
  const el = document.getElementById(`story-${n}`)
  if (top === null || !el) return
  window.scrollTo({ top, behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

// ── Save ──────────────────────────────────────────────────────────────
const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
    <path d="M4 1.5h8v13l-4-3-4 3z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

export function SaveButton({ story, className = '' }: { story: PublicStory; className?: string }) {
  const reader = useReader()
  const store = readerStores().saved
  const saved = useStore(store)
  if (!reader?.interactive) return null
  const isSaved = saved.some((s) => s.id === story.id)
  return (
    <button
      type="button"
      aria-pressed={isSaved}
      className={`group inline-flex min-h-11 items-center gap-2 text-[0.875rem] font-semibold text-forest ${className}`}
      onClick={() => store.set(toggleSaved(store.get(), { id: story.id, date: reader.edition.date, position: story.position, headline: story.headline, sourceName: story.sourceName, category: story.category }))}
    >
      <BookmarkIcon filled={isSaved} />
      <span className="link-quiet">{isSaved ? 'Saved' : 'Save story'}</span>
      <span className="sr-only">: {story.headline}</span>
    </button>
  )
}

// ── Mobile and tablet: the story strip under the header ───────────────
/**
 * Five numbered targets, full-width so each is a comfortable tap even at 320px. The current story is filled;
 * stories already passed show a filled square. It sits inside the sticky header, so it never covers the text.
 */
export function StoryStrip({ stories }: { stories: PublicStory[] }) {
  const { story: current } = useReadingPosition()
  return (
    <nav aria-label="Stories in this edition" className="story-strip border-t border-line">
      <ol className="flex">
        {stories.map((s) => {
          const here = s.position === current
          return (
            <li key={s.id} className="flex-1">
              <a
                href={`#story-${s.position}`}
                aria-current={here ? 'location' : undefined}
                aria-label={`Story ${s.position} of ${stories.length}: ${s.headline}`}
                onClick={(e) => {
                  e.preventDefault()
                  history.replaceState(null, '', `#story-${s.position}`)
                  goToStory(s.position)
                }}
                className={`flex h-11 items-center justify-center gap-1.5 border-r border-line text-[0.75rem] font-semibold tabular-nums tracking-[0.08em] transition-colors last:border-r-0 ${here ? 'bg-forest text-chalk' : 'text-forest hover:bg-mist'}`}
              >
                <span className={`size-1.5 ${here ? 'bg-chalk' : s.position < current ? 'bg-forest' : 'border border-forest'}`} aria-hidden="true" />
                {two(s.position)}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ── Wide screens: the contents rail in the left margin ────────────────
/**
 * Shown only where the margin is wide enough (CSS: 1440px and up), so it never narrows or overlaps the reading
 * column. Category and number are visible; the full headline is in the accessible name and tooltip.
 */
export function ContentsRail({ stories }: { stories: PublicStory[] }) {
  const { story: current, finished } = useReadingPosition()
  return (
    <nav aria-label="Contents" className={`contents-rail ${finished ? 'is-past' : ''}`}>
      <p className="label mb-3 text-earth">Contents</p>
      <ol className="space-y-1">
        {stories.map((s) => {
          const here = s.position === current
          return (
            <li key={s.id}>
              <a
                href={`#story-${s.position}`}
                title={s.headline}
                aria-current={here ? 'location' : undefined}
                aria-label={`Story ${s.position}: ${s.headline}`}
                onClick={(e) => {
                  e.preventDefault()
                  history.replaceState(null, '', `#story-${s.position}`)
                  goToStory(s.position)
                }}
                className={`group flex min-h-11 items-center gap-3 border-l-2 py-1 pl-3 transition-colors ${here ? 'border-forest' : 'border-transparent hover:border-sage'}`}
              >
                <span className={`font-display text-[1.375rem] leading-none tabular-nums ${here ? 'text-forest' : s.position < current ? 'text-sage-deep' : 'text-ink/55'}`}>{two(s.position)}</span>
                <span className={`label leading-tight ${here ? 'text-forest' : 'text-ink/70'}`}>{CATEGORIES[s.category].short}</span>
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ── Remember the place, and offer to return to it ─────────────────────
/** Writes at most every few seconds, and when the page is hidden or closed. */
const WRITE_EVERY_MS = 4000

export function ResumeReading() {
  const reader = useReader()
  const position = useReadingPosition()
  const store = readerStores().progress
  const date = reader?.edition.date
  const interactive = Boolean(reader?.interactive)
  // The offer is decided once, from what was stored before this visit and the URL it opened with.
  const [offer, setOffer] = useState<Progress | null>(() => (interactive && date ? resumeOffer(store.get(), date, typeof location !== 'undefined' ? location.hash : '') : null))
  const latest = useRef(position)
  latest.current = position
  const lastWrite = useRef(0)

  const write = () => {
    if (!interactive || !date) return
    const p = latest.current
    if (p.story < 1) return
    const next = recordProgress(store.get(), date, { story: p.story, fraction: p.fraction, finished: p.finished })
    if (next !== store.get()) store.set(next)
    lastWrite.current = Date.now()
  }

  // Throttled writes while reading.
  useEffect(() => {
    if (!interactive || position.story < 1) return
    if (Date.now() - lastWrite.current >= WRITE_EVERY_MS) write()
    else {
      const t = setTimeout(write, WRITE_EVERY_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.story, position.fraction, position.finished, interactive, date])

  // A final write when the reader leaves or switches away.
  useEffect(() => {
    if (!interactive) return
    const flush = () => document.visibilityState === 'hidden' && write()
    window.addEventListener('pagehide', write)
    document.addEventListener('visibilitychange', flush)
    return () => {
      write()
      window.removeEventListener('pagehide', write)
      document.removeEventListener('visibilitychange', flush)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, date])

  // Once they are reading at or past the remembered story, the offer has served its purpose.
  useEffect(() => {
    if (offer && position.story >= offer.story) setOffer(null)
  }, [offer, position.story])

  if (!offer || !date) return null
  const dismiss = () => {
    store.set(dismissProgress(store.get(), date))
    setOffer(null)
  }
  return (
    <aside aria-label="Continue reading" className="border-b border-line bg-mist">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2`}>
        <p className="text-[0.875rem] text-ink">
          You were reading story {offer.story} of 5.
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn min-h-11 border-forest bg-forest px-3 py-1 text-chalk hover:!bg-forest-deep"
            onClick={() => {
              const target = offer
              setOffer(null)
              goToStory(target.story, target.fraction)
            }}
          >
            Continue where you left off
          </button>
          <button type="button" aria-label="Dismiss: start from the top" className="grid size-11 place-items-center text-ink/70 hover:text-forest" onClick={dismiss}>
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
