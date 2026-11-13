import type { PublicStory } from '../lib/types'
import { wrap } from './Brand'
import { Reveal } from './Reveal'
import { StoryFigure, StoryMeta, StorySource } from './StoryParts'

/** Story one: the lead. Full-bleed photograph on phones, a 7/5 split on desktop. */
export function FeaturedStory({ story, isDemo }: { story: PublicStory; isDemo: boolean }) {
  return (
    <article id={`story-${story.position}`} data-story={story.position} className={`${wrap} pb-16 lg:pb-28`}>
      <div className="lg:grid lg:grid-cols-12 lg:items-end lg:gap-12">
        <div className="relative isolate -mx-5 sm:mx-0 lg:col-span-7">
          <StoryFigure story={story} ratio="aspect-[4/5] sm:aspect-[4/3] lg:aspect-[5/6]" sizes="(min-width: 1024px) 58vw, 100vw" eager />
          <span className="absolute -bottom-6 right-5 size-[5.5rem] bg-sage sm:right-8 lg:-right-8 lg:size-32" aria-hidden="true" />
          <span className="absolute -bottom-10 right-[7.75rem] size-6 bg-blush sm:right-[8.5rem] lg:-bottom-12 lg:right-28 lg:size-8" aria-hidden="true" />
        </div>
        <Reveal className="mt-14 lg:col-span-5 lg:mt-0 lg:pb-2">
          <StoryMeta story={story} />
          <h2 className="display mt-4 text-[2.5rem] sm:text-5xl lg:text-[3.5rem]">{story.headline}</h2>
          <p className="prose-story mt-5 text-[1.125rem] leading-[1.58]">{story.summary}</p>
          <StorySource story={story} isDemo={isDemo} className="mt-7" />
        </Reveal>
      </div>
    </article>
  )
}
