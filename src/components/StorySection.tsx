import type { PublicStory } from '../lib/types'
import { FiveSquares, wrap } from './Brand'
import { Reveal } from './Reveal'
import { StoryFigure, StoryMeta, StorySource, two } from './StoryParts'

export type StoryVariant = 'offset' | 'band' | 'wide' | 'inset'

interface Props {
  story: PublicStory
  isDemo: boolean
}

const anchor = (story: PublicStory) => ({ id: `story-${story.position}`, 'data-story': story.position })

/** A square photograph pushed off-centre, with a sage square stepping out behind it. */
function Offset({ story, isDemo }: Props) {
  return (
    <article {...anchor(story)} className={`${wrap} pb-16 pt-4 lg:pb-28`}>
      <div className="lg:grid lg:grid-cols-12 lg:items-center lg:gap-12">
        <div className="relative isolate ml-auto w-[82%] sm:w-[60%] lg:order-2 lg:col-span-5 lg:col-start-8 lg:w-full">
          <span className="absolute -bottom-7 -left-7 -z-10 size-32 bg-sage lg:-bottom-10 lg:-left-10 lg:size-44" aria-hidden="true" />
          <StoryFigure story={story} ratio="aspect-square" sizes="(min-width: 1024px) 40vw, 82vw" />
          <span className="absolute -top-3 right-6 size-6 bg-forest" aria-hidden="true" />
        </div>
        <Reveal className="mt-16 lg:order-1 lg:col-span-6 lg:mt-0">
          <StoryMeta story={story} />
          <h2 className="display mt-4 text-[2.125rem] sm:text-[2.5rem] lg:text-[3rem]">{story.headline}</h2>
          <p className="prose-story mt-5 max-w-[34rem]">{story.summary}</p>
          <StorySource story={story} isDemo={isDemo} className="mt-7 max-w-[34rem]" />
        </Reveal>
      </div>
    </article>
  )
}

/** A full-width tinted band led by an oversized numeral. Works with or without a photograph. */
function Band({ story, isDemo }: Props) {
  return (
    <article {...anchor(story)} className="bg-mist">
      <div className={`${wrap} py-16 lg:grid lg:grid-cols-12 lg:gap-12 lg:py-28`}>
        <div className="flex items-start gap-3 lg:col-span-4" aria-hidden="true">
          <span className="display text-[7.5rem] !leading-[0.78] !text-sage lg:text-[12rem]">{two(story.position)}</span>
          <span className="mt-1 size-5 bg-blush lg:size-7" />
        </div>
        <Reveal className="mt-9 lg:col-span-8 lg:mt-0">
          <StoryMeta story={story} />
          <h2 className="display mt-4 text-[2.375rem] sm:text-5xl lg:text-[3.75rem]">{story.headline}</h2>
          {story.imageUrl && <StoryFigure story={story} ratio="aspect-[3/2]" className="mt-7" sizes="(min-width: 1024px) 60vw, 100vw" />}
          <p className="prose-story mt-6 max-w-[36rem]">{story.summary}</p>
          <StorySource story={story} isDemo={isDemo} className="mt-7 max-w-[36rem] !border-sage" />
        </Reveal>
      </div>
    </article>
  )
}

/** Headline first, then a wide photograph with squares clipped to its top edge. */
function Wide({ story, isDemo }: Props) {
  return (
    <article {...anchor(story)} className={`${wrap} py-16 lg:py-28`}>
      <Reveal>
        <StoryMeta story={story} />
        <h2 className="display mt-4 max-w-[13em] text-[2.125rem] sm:text-[2.5rem] lg:text-[3.5rem]">{story.headline}</h2>
      </Reveal>
      <div className="relative isolate -mx-5 mt-10 sm:mx-0">
        <StoryFigure story={story} ratio="aspect-[3/2] lg:aspect-[21/9]" sizes="100vw" />
        <span className="absolute -top-5 right-5 size-12 bg-earth sm:right-8 lg:size-16" aria-hidden="true" />
        <span className="absolute -top-2 right-[4.75rem] size-5 bg-chalk sm:right-[5.5rem] lg:right-28" aria-hidden="true" />
      </div>
      <Reveal className="mt-7 lg:mt-10 lg:grid lg:grid-cols-12 lg:gap-12">
        <p className="prose-story lg:col-span-6">{story.summary}</p>
        <StorySource story={story} isDemo={isDemo} className="mt-7 lg:col-span-4 lg:col-start-9 lg:mt-1" />
      </Reveal>
    </article>
  )
}

/** A tall, narrow photograph with the numeral and the five squares standing beside it. */
function Inset({ story, isDemo }: Props) {
  return (
    <article {...anchor(story)} className={wrap}>
      <div className="border-t border-line py-16 lg:grid lg:grid-cols-12 lg:items-end lg:gap-12 lg:py-28">
        <div className="flex items-end gap-5 lg:col-span-5">
          <div className="relative isolate w-[62%] lg:w-[70%]">
            <span className="absolute -left-3 -top-3 -z-10 size-14 bg-blush" aria-hidden="true" />
            <StoryFigure story={story} ratio="aspect-[4/5]" sizes="(min-width: 1024px) 30vw, 62vw" />
          </div>
          <div className="pb-1" aria-hidden="true">
            <span className="display block text-[4.5rem] !leading-[0.8] lg:text-[6rem]">{two(story.position)}</span>
            <FiveSquares size={8} gap={4} className="mt-4" />
          </div>
        </div>
        <Reveal className="mt-10 lg:col-span-6 lg:col-start-7 lg:mt-0">
          <StoryMeta story={story} />
          <h2 className="display mt-4 text-[2.125rem] sm:text-[2.5rem] lg:text-[3rem]">{story.headline}</h2>
          <p className="prose-story mt-5">{story.summary}</p>
          <StorySource story={story} isDemo={isDemo} className="mt-7" />
        </Reveal>
      </div>
    </article>
  )
}

const VARIANTS = { offset: Offset, band: Band, wide: Wide, inset: Inset }

export function StorySection({ variant, ...props }: Props & { variant: StoryVariant }) {
  const Layout = VARIANTS[variant]
  return <Layout {...props} />
}
