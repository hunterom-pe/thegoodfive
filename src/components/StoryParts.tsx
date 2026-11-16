import { useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES } from '../lib/categories'
import { formatShort, sourceDay } from '../lib/dates'
import type { PublicStory } from '../lib/types'
import { Arrow } from './Brand'
import { StoryArt } from './StoryArt'
import { StoryActions } from './ReaderTools'

export const two = (n: number) => String(n).padStart(2, '0')

/**
 * The story's number as a typographic element. All five stories use this one size, so no story outranks another;
 * each composition frames it differently. Decorative: the number is announced once, by StoryMeta.
 */
export function StoryNumeral({ story, className = '' }: { story: PublicStory; className?: string }) {
  return (
    <span aria-hidden="true" className={`display block shrink-0 tabular-nums text-[4.25rem] !leading-[0.8] lg:text-[5.5rem] ${className}`}>
      {two(story.position)}
    </span>
  )
}

/** ■ Nature & Wildlife. The number is spoken here ("Story 1 of 5") and shown by StoryNumeral, so it is not repeated as text. */
export function StoryMeta({ story, total = 5, className = '' }: { story: PublicStory; total?: number; className?: string }) {
  return (
    <p className={`label flex items-center gap-2.5 text-forest ${className}`}>
      <span className="size-2 shrink-0 bg-forest" aria-hidden="true" />
      <span className="sr-only">
        Story {story.position} of {total}:{' '}
      </span>
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

/**
 * "An update to…" / "What happened next?": quiet links between stories an editor has connected and approved.
 * Context only: they point to the other story in its own dated edition and never add a story to this one.
 */
export function FollowUpLinks({ story }: { story: PublicStory }) {
  if (!story.followUps?.length) return null
  return (
    <div className="mt-4 space-y-3">
      {story.followUps.map((f) => (
        <div key={f.id} className="border-l-2 border-sage pl-3">
          <p className="label text-sage-deep">{f.kind === 'update-to' ? 'An update to' : 'What happened next?'}</p>
          <p className="mt-1 text-[0.9375rem] leading-snug">
            <Link to={`/edition/${f.date}#story-${f.position}`} className="link-quiet font-display text-[1.0625rem] text-forest">
              {f.headline}
            </Link>{' '}
            <span className="whitespace-nowrap text-[0.8125rem] text-ink/60">· {formatShort(f.date)}</span>
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink/70">
            {f.explanation}{' '}
            <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="link-quiet font-semibold text-forest">
              Source<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      ))}
    </div>
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
            <time dateTime={sourceDay(story.sourcePublishedOn, story.sourcePublishedAt)!}>{formatShort(sourceDay(story.sourcePublishedOn, story.sourcePublishedAt)!)}</time>
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
      <FollowUpLinks story={story} />
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
