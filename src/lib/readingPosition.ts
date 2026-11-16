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
/** Where the reading line sits, as a share of the viewport height. Measuring and restoring must use the same line. */
export const READING_LINE = 0.45

export function measurePosition(stories: { n: number; top: number; height: number }[], endTop: number | null, viewportHeight: number): ReadingPosition {
  const line = viewportHeight * READING_LINE
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

/** Just the current story number: components using this re-render only when the story changes, not on every scroll step. */
export function useCurrentStory(): number {
  return useSyncExternalStore(subscribe, () => current.story, () => 0)
}

/** Whether the back cover is in view. */
export function useEditionFinished(): boolean {
  return useSyncExternalStore(subscribe, () => current.finished, () => false)
}

/**
 * The scroll position that puts `fraction` of a story back at the reading line, which is how that fraction was
 * measured. (An earlier version placed it near the top, so a restored view sat a third of a screen further on
 * than the place remembered, and near a story's end it landed in the next story.) A story's own top never sits
 * lower than just under the sticky header, so a small fraction simply shows the story from its start.
 */
export function scrollTargetFor(story: { top: number; height: number }, fraction: number, scrollY: number, viewportHeight: number, padding: number): number {
  const f = Math.min(1, Math.max(0, fraction))
  const desiredTop = Math.min(padding, viewportHeight * READING_LINE - story.height * f)
  return Math.max(0, scrollY + story.top - desiredTop)
}

/** The y-coordinate to scroll to so that `fraction` of story `n` sits at the reading line (see scrollTargetFor). */
export function storyScrollTarget(n: number, fraction: number): number | null {
  const el = document.getElementById(`story-${n}`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 72
  return scrollTargetFor({ top: r.top, height: r.height }, fraction, window.scrollY, window.innerHeight, padding)
}
