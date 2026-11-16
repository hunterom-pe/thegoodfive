import type { PublicStory } from '../lib/types'
import { FiveSquares, wrap } from './Brand'
import { Reveal } from './Reveal'
import { StoryFigure, StoryMeta, StoryNumeral, StorySource } from './StoryParts'

export type StoryVariant = 'offset' | 'band' | 'wide' | 'inset'

interface Props {
  story: PublicStory
  isDemo: boolean
}

const anchor = (story: PublicStory) => ({ id: `story-${story.position}`, 'data-story': story.position })

/** A square photograph pushed off-centre, with a sage square stepping out behind it. The numeral carries its own small sage square. */
function Offset({ story, isDemo }: Props) {
  const heading = (
    <div className="flex items-end gap-4">
      <span className="relative isolate block">
        <span className="absolute -bottom-1 -left-2.5 -z-10 size-9 bg-sage lg:-left-3 lg:size-12" aria-hidden="true" />
        <StoryNumeral story={story} />
      </span>
      <StoryMeta story={story} className="mb-1 lg:mb-2" />
    </div>
  )
  return (
    <article {...anchor(story)} className={`${wrap} pb-16 lg:pb-28 lg:pt-4`}>
      {/* On phones a hairline closes the previous story and the numeral opens this one, above its photograph. */}
      <div className="border-t border-line pt-8 lg:grid lg:grid-cols-12 lg:items-center lg:gap-12 lg:border-t-0 lg:pt-0">
        <div className="mb-8 lg:hidden">{heading}</div>
        <Reveal variant="media" className="relative isolate ml-auto w-[82%] sm:w-[60%] lg:order-2 lg:col-span-5 lg:col-start-8 lg:w-full">
          <span data-sq="1" data-from="left" className="absolute -bottom-7 -left-7 -z-10 size-32 bg-sage lg:-bottom-10 lg:-left-10 lg:size-44" aria-hidden="true" />
          <StoryFigure story={story} ratio="aspect-square" sizes="(min-width: 1024px) 40vw, 82vw" />
          <span data-sq="2" data-from="top" className="absolute -top-3 right-6 size-6 bg-forest" aria-hidden="true" />
        </Reveal>
        <Reveal className="mt-14 lg:order-1 lg:col-span-6 lg:mt-0">
          <div className="mb-6 max-lg:hidden">{heading}</div>
          <h2 className="display text-[2.125rem] sm:text-[2.5rem] lg:text-[3rem]">{story.headline}</h2>
          <p className="prose-story mt-5 max-w-[34rem]">{story.summary}</p>
          <StorySource story={story} isDemo={isDemo} className="mt-7 max-w-[34rem]" />
        </Reveal>
      </div>
    </article>
  )
}

/** A tinted band, kept compact: the numeral (same size as the others) sits right above the headline; on desktop the photograph stands beside the text. */
function Band({ story, isDemo }: Props) {
  return (
    <article {...anchor(story)} className="bg-mist">
      <div className={`${wrap} py-11 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:py-16`}>
        <Reveal className="lg:col-span-7 lg:row-start-1">
          <div className="flex items-end gap-3">
            <StoryNumeral story={story} />
            <span data-sq="1" data-from="right" className="mb-1 size-4 shrink-0 bg-blush lg:mb-2 lg:size-5" aria-hidden="true" />
            <StoryMeta story={story} className="mb-1 ml-auto lg:mb-2" />
          </div>
          <h2 className="display mt-6 text-[2.125rem] sm:text-[2.5rem] lg:text-[3rem]">{story.headline}</h2>
        </Reveal>
        {story.imageUrl && (
          <Reveal variant="media" className="mt-7 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-center">
            <StoryFigure story={story} ratio="aspect-[3/2] lg:aspect-[4/5]" sizes="(min-width: 1024px) 40vw, 100vw" />
          </Reveal>
        )}
        <Reveal className="mt-6 lg:col-span-7 lg:row-start-2 lg:mt-5">
          <p className="prose-story max-w-[36rem]">{story.summary}</p>
          <StorySource story={story} isDemo={isDemo} className="mt-7 max-w-[36rem] !border-sage" />
        </Reveal>
      </div>
    </article>
  )
}

/** Headline first, under a divider that carries the numeral; then a wide photograph with squares clipped to its top edge. */
function Wide({ story, isDemo }: Props) {
  return (
    <article {...anchor(story)} className={`${wrap} py-14 lg:py-24`}>
      <Reveal>
        <div className="flex items-end gap-4">
          <StoryNumeral story={story} />
          <span className="mb-2 flex flex-1 items-center lg:mb-3" aria-hidden="true">
            <span className="h-px flex-1 bg-forest" />
            <span className="size-2.5 bg-earth" />
          </span>
          <StoryMeta story={story} className="mb-1 lg:mb-2" />
        </div>
        <h2 className="display mt-6 max-w-[13em] text-[2.125rem] sm:text-[2.5rem] lg:text-[3.5rem]">{story.headline}</h2>
      </Reveal>
      <Reveal variant="media" className="relative isolate -mx-5 mt-10 sm:mx-0">
        <StoryFigure story={story} ratio="aspect-[3/2] lg:aspect-[21/9]" sizes="100vw" />
        <span data-sq="1" data-from="right" className="absolute -top-5 right-5 size-12 bg-earth sm:right-8 lg:size-16" aria-hidden="true" />
        <span data-sq="2" data-from="left" className="absolute -top-2 right-[4.75rem] size-5 bg-chalk sm:right-[5.5rem] lg:right-28" aria-hidden="true" />
      </Reveal>
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
      <div className="border-t border-line py-14 lg:grid lg:grid-cols-12 lg:items-end lg:gap-12 lg:py-24">
        <Reveal variant="media" className="flex items-end gap-5 lg:col-span-5">
          <div className="relative isolate w-[62%] lg:w-[70%]">
            <span data-sq="1" data-from="left" className="absolute -left-3 -top-3 -z-10 size-14 bg-blush" aria-hidden="true" />
            <StoryFigure story={story} ratio="aspect-[4/5]" sizes="(min-width: 1024px) 30vw, 62vw" />
          </div>
          <div data-sq="2" className="pb-1">
            <StoryNumeral story={story} />
            <FiveSquares size={8} gap={4} className="mt-4" />
          </div>
        </Reveal>
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
