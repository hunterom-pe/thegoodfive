import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES } from '../lib/categories'
import { formatShort } from '../lib/dates'
import type { PublicStory } from '../lib/types'
import { Arrow } from './Brand'
import { StoryArt } from './StoryArt'

export const two = (n: number) => String(n).padStart(2, '0')

/** ■ 01 / 05 ── Nature & Wildlife */
export function StoryMeta({ story, total = 5, className = '' }: { story: PublicStory; total?: number; className?: string }) {
  return (
    <p className={`label flex items-center gap-2.5 text-forest ${className}`}>
      <span className="size-2 bg-forest" aria-hidden="true" />
      <span className="tabular-nums">
        {two(story.position)} <span className="text-sage">/</span> {two(total)}
      </span>
      <span className="h-px w-5 bg-sage" aria-hidden="true" />
      <span className="text-earth">{CATEGORIES[story.category].label}</span>
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
        {story.imageUrl && story.imageCredit && <> · Photo: {story.imageCredit}</>}
        {isDemo && <span className="label ml-2 border border-earth/50 px-1.5 py-0.5 text-[0.5625rem] text-earth">Sample</span>}
      </p>
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
    </div>
  )
}

/** Unsplash can resize on the fly; give phones a phone-sized file. */
function responsive(url: string): { srcSet?: string } {
  if (!url.startsWith('https://images.unsplash.com/')) return {}
  const at = (w: number) => `${url.replace(/([?&])w=\d+/, `$1w=${w}`)} ${w}w`
  return { srcSet: [480, 800, 1200, 1800].map(at).join(', ') }
}

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
  const showPhoto = story.imageUrl && !failed
  return (
    <div className={`relative overflow-hidden bg-mist ${ratio} ${className}`}>
      {showPhoto ? (
        <img
          src={story.imageUrl!}
          {...responsive(story.imageUrl!)}
          sizes={sizes}
          alt={story.imageAlt ?? ''}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <StoryArt category={story.category} />
      )}
    </div>
  )
}
