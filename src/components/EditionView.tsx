import { Link } from 'react-router-dom'
import type { PublicEdition } from '../lib/types'
import { wrap } from './Brand'
import { EditionClosing } from './EditionClosing'
import { EditionHero, type EditionContext } from './EditionHero'
import { FeaturedStory } from './FeaturedStory'
import { StorySection, type StoryVariant } from './StorySection'

/** Stories two to five each get their own composition, in a fixed rhythm. */
const RHYTHM: StoryVariant[] = ['offset', 'band', 'wide', 'inset']

export function DemoNotice() {
  return (
    <p className="bg-mist">
      <span className={`${wrap} flex items-center gap-2.5 py-2.5 text-[0.75rem] leading-snug text-ink/75`}>
        <span className="size-1.5 shrink-0 bg-earth" aria-hidden="true" />
        <span>
          Demo edition. These are sample stories, not real reporting.{' '}
          <Link to="/about#demo" className="link-quiet font-semibold text-forest">
            Why?
          </Link>
        </span>
      </span>
    </p>
  )
}

/** One complete edition on one continuous page: hero, five stories, back cover. */
export function EditionView({ edition, context }: { edition: PublicEdition; context: EditionContext }) {
  const [lead, ...rest] = edition.stories
  return (
    <>
      {edition.isDemo && <DemoNotice />}
      <EditionHero edition={edition} context={context} />
      {lead && <FeaturedStory story={lead} isDemo={edition.isDemo} />}
      {rest.map((story, i) => (
        <StorySection key={story.id} story={story} isDemo={edition.isDemo} variant={RHYTHM[i % RHYTHM.length]} />
      ))}
      <EditionClosing edition={edition} context={context} />
    </>
  )
}
