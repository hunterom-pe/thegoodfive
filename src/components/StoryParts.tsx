import { useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES } from '../lib/categories'
import { formatShort } from '../lib/dates'
import type { PublicStory } from '../lib/types'
import { Arrow } from './Brand'
import { StoryArt } from './StoryArt'
import { StoryActions } from './ReaderTools'

export const two = (n: number) => String(n).padStart(2, '0')

/** ■ 01 / 05 ── Nature & Wildlife */
export function StoryMeta({ story, total = 5, className = '' }: { story: PublicStory; total?: number; className?: string }) {
  return (
    <p className={`label flex items-center gap-2.5 text-forest ${className}`}>
      <span className="size-2 bg-forest" aria-hidden="true" />
      <span className="tabular-nums">
        {two(story.position)} <span className="text-sage-deep">/</span> {two(total)}
      </span>
      <span className="h-px w-5 bg-sage" aria-hidden="true" />
      <span className="text-earth">{CATEGORIES[story.category].label}</span>
    </p>
  )
}

/**
 * Images that failed to load, by story. The caption lives in StorySource, away from
 * the photograph, so it asks this list: a credit is never shown for a picture that isn't there.
 */
const brokenImages = new Set<string>()
const listeners = new Set<() => void>()
const markBroken = (key: string) => {
  if (brokenImages.has(key)) return
  brokenImages.add(key)
  listeners.forEach((l) => l())
}
const imageKey = (s: PublicStory) => `${s.id}|${s.imageUrl}`
function useImageBroken(story: PublicStory): boolean {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => brokenImages.has(imageKey(story)),
    () => false,
  )
}

const UNSPLASH = 'https://unsplash.com/?utm_source=thegoodfive&utm_medium=referral'
const safe = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null)

/**
 * Who took the photo, and what kind of photo it is. A representative photo is
 * always labelled illustrative so it is never mistaken for the reported event.
 * For Unsplash we credit the photographer and Unsplash, with links, as its API guidelines require.
 */
function PhotoCredit({ story }: { story: PublicStory }) {
  const link = 'link-quiet font-semibold text-ink'
  const credit = story.imageCredit
  const creditUrl = safe(story.imageCreditUrl)
  const onUnsplash = Boolean(story.imageSourceUrl?.includes('unsplash.com'))
  const name = credit ? creditUrl ? <a href={creditUrl} target="_blank" rel="noopener noreferrer" className={link}>{credit}</a> : <span className="font-semibold text-ink">{credit}</span> : null
  return (
    <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink/70">
      {story.imageKind === 'illustrative' ? 'Illustrative photo' : 'Photo'}
      {name && <> by {name}</>}
      {onUnsplash && (
        <>
          {' '}
          on{' '}
          <a href={UNSPLASH} target="_blank" rel="noopener noreferrer" className={link}>
            Unsplash
          </a>
        </>
      )}
      {story.imageKind === 'illustrative' && <>. Representative, not from the reported event.</>}
    </p>
  )
}

/** Attribution and the way out to the original reporting. */
export function StorySource({ story, isDemo, className = '' }: { story: PublicStory; isDemo: boolean; className?: string }) {
  const linkClass = 'group mt-1 inline-flex min-h-11 items-center gap-3 text-[0.9375rem] font-semibold text-forest'
  const chip = (
    <span className="grid size-6 place-items-center bg-forest text-chalk transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
      <Arrow />
    </span>
  )
  const photoBroken = useImageBroken(story)
  return (
    <div className={`border-t border-line pt-4 ${className}`}>
      <p className="text-[0.8125rem] leading-relaxed text-ink/70">
        Reported by <span className="font-semibold text-ink">{story.sourceName}</span>
        {story.sourcePublishedAt && (
          <>
            {' · '}
            <time dateTime={story.sourcePublishedAt.slice(0, 10)}>{formatShort(story.sourcePublishedAt)}</time>
          </>
        )}
        {isDemo && <span className="label ml-2 border border-earth/50 px-1.5 py-0.5 text-[0.5625rem] text-earth">Sample</span>}
      </p>
      {story.imageUrl && !photoBroken && <PhotoCredit story={story} />}
      {isDemo || !/^https?:\/\//i.test(story.sourceUrl) ? (
        <Link to="/about#demo" className={linkClass}>
          <span className="link-quiet">About this sample story</span>
          {chip}
        </Link>
      ) : (
        <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <span className="link-quiet">
            Read the original at {story.sourceName}
            <span className="sr-only"> (opens in a new tab)</span>
          </span>
          {chip}
        </a>
      )}
      <StoryActions story={story} />
    </div>
  )
}

/**
 * Unsplash serves any width on demand. We add size, format and quality, and keep
 * every other parameter (including ixid, which Unsplash requires us to preserve).
 */
export function sizedImage(url: string, width: number): string {
  try {
    const u = new URL(url)
    if (u.hostname !== 'images.unsplash.com') return url
    u.searchParams.set('w', String(width))
    u.searchParams.set('auto', 'format')
    u.searchParams.set('fit', 'crop')
    u.searchParams.set('q', '72')
    return u.toString()
  } catch {
    return url
  }
}

const responsive = (url: string): { srcSet?: string } => (url.includes('images.unsplash.com') ? { srcSet: [480, 800, 1200, 1800].map((w) => `${sizedImage(url, w)} ${w}w`).join(', ') } : {})

export function StoryFigure({
  story,
  ratio,
  sizes = '(min-width: 1024px) 50vw, 100vw',
  eager = false,
  className = '',
}: {
  story: PublicStory
  /** Tailwind aspect-ratio classes; the frame holds its shape before the image loads. */
  ratio: string
  sizes?: string
  eager?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const showPhoto = story.imageUrl && !failed
  return (
    <div className={`relative overflow-hidden bg-mist ${ratio} ${className}`}>
      {showPhoto ? (
        <img
          src={sizedImage(story.imageUrl!, 1200)}
          {...responsive(story.imageUrl!)}
          sizes={sizes}
          alt={story.imageAlt || (story.imageKind === 'illustrative' ? 'Illustrative photo' : '')}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          decoding="async"
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0) setLoaded(true) // already cached
          }}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true)
            markBroken(imageKey(story))
          }}
          className={`absolute inset-0 size-full object-cover ${loaded ? 'is-loaded' : ''}`}
        />
      ) : (
        <StoryArt category={story.category} />
      )}
    </div>
  )
}
