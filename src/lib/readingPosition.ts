import { useSyncExternalStore } from 'react'

/**
 * Where the reader is in the edition, measured once per animation frame by one shared scroll listener and
 * shared by every component that needs it (the header squares, the mobile strip, the contents rail and the
 * resume memory). Story sections carry data-story="1".."5"; the back cover carries data-edition-end.
 */
export interface ReadingPosition {
  /** The story at the reading line, 0 before the first story. */
  story: number
  /** How far through that story the reading line is, 0 to 1. */
  fraction: number
  /** The back cover has come into view. */
  finished: boolean
}

const START: ReadingPosition = { story: 0, fraction: 0, finished: false }

/** The pure measurement, given each story's top and height and the back cover's top (viewport coordinates). */
export function measurePosition(stories: { n: number; top: number; height: number }[], endTop: number | null, viewportHeight: number): ReadingPosition {
  const line = viewportHeight * 0.45
  let story = 0
  let fraction = 0
  for (const s of stories) {
    if (s.top <= line && s.n >= story) {
      story = s.n
      fraction = s.height > 0 ? Math.min(1, Math.max(0, (line - s.top) / s.height)) : 0
    }
  }
  return { story, fraction, finished: endTop !== null && endTop <= viewportHeight * 0.6 }
}

let current: ReadingPosition = START
const listeners = new Set<() => void>()
let frame = 0

function measure() {
  frame = 0
  const stories = [...document.querySelectorAll<HTMLElement>('[data-story]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { n: Number(el.dataset.story), top: r.top, height: r.height }
  })
  const end = document.querySelector('[data-edition-end]')?.getBoundingClientRect().top ?? null
  const next = measurePosition(stories, end, window.innerHeight)
  // Only a real change creates a new object (and a re-render); fraction is kept to 1% steps.
  next.fraction = Math.round(next.fraction * 100) / 100
  if (next.story !== current.story || next.fraction !== current.fraction || next.finished !== current.finished) {
    current = next
    listeners.forEach((l) => l())
  }
}
const schedule = () => {
  if (!frame) frame = requestAnimationFrame(measure)
}

let resized: ResizeObserver | null = null

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // Content arriving (the edition loads after the page), photos loading and reveals all move the stories
    // without a scroll event: measure again whenever the page's size changes.
    if (typeof ResizeObserver !== 'undefined') {
      resized = new ResizeObserver(schedule)
      resized.observe(document.body)
    }
  }
  listeners.add(listener)
  schedule()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      resized?.disconnect()
      resized = null
      cancelAnimationFrame(frame)
      frame = 0
      current = START
    }
  }
}

export function useReadingPosition(): ReadingPosition {
  return useSyncExternalStore(subscribe, () => current, () => START)
}

/** The y-coordinate to scroll to so that `fraction` of story `n` sits just below the sticky header. */
export function storyScrollTarget(n: number, fraction: number): number | null {
  const el = document.getElementById(`story-${n}`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 72
  return Math.max(0, window.scrollY + r.top + r.height * fraction - padding - window.innerHeight * 0.1 * Math.min(1, fraction * 4))
}
