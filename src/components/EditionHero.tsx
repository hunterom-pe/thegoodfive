import { CATEGORIES } from '../lib/categories'
import { formatDayMonth, formatLong, formatWeekday } from '../lib/dates'
import type { PublicEdition } from '../lib/types'
import { wrap } from './Brand'
import { two } from './StoryParts'

export type EditionContext = 'today' | 'latest' | 'archive'

/**
 * The hero never claims more than is true: "today" copy only appears when
 * the edition really is dated today on the publication's clock.
 */
function copy(context: EditionContext, date: string) {
  const weekday = formatWeekday(date)
  switch (context) {
    case 'today':
      return {
        kicker: 'Today’s edition',
        title: 'Good things happened today.',
        sub: 'Here are five worth knowing about.',
        note: 'A small daily collection of encouraging developments, chosen by a person. Read it in a few minutes, then get on with your day.',
      }
    case 'latest':
      return {
        kicker: 'Latest edition',
        title: 'Good things are still happening.',
        sub: `Here are five from ${weekday}.`,
        note: `Today’s edition is still with our editor. Until it’s ready, this is the most recent one, published on ${formatDayMonth(date)}.`,
      }
    case 'archive':
      return {
        kicker: 'From the archive',
        title: `Good things happened on ${weekday}.`,
        sub: 'Here are the five we chose that day.',
        note: 'This edition is kept exactly as it ran: the same five stories, in the same order, with their original sources.',
      }
  }
}

export function EditionHero({ edition, context }: { edition: PublicEdition; context: EditionContext }) {
  const text = copy(context, edition.date)
  return (
    <section className={`${wrap} relative pb-10 pt-8 sm:pt-12 lg:pb-16 lg:pt-20`}>
      <div className="lg:grid lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-8">
          <p className="label flex flex-wrap items-center gap-x-2.5 gap-y-1 text-earth">
            <span className="size-2 bg-forest" aria-hidden="true" />
            <span className="text-forest">{text.kicker}</span>
            <span className="h-px w-5 bg-sage" aria-hidden="true" />
            <time dateTime={edition.date}>{formatLong(edition.date)}</time>
          </p>
          <h1 className="display mt-5 text-[2.875rem] sm:text-[4rem] lg:text-[5.75rem] lg:leading-[0.96]">{text.title}</h1>
          <p className="display display-wonk mt-3 text-[1.5625rem] !leading-[1.12] !text-earth sm:text-[2rem] lg:mt-5 lg:text-[2.625rem]">{text.sub}</p>
        </div>

        {/* Squares: a quiet composition that anchors the hero's right edge. */}
        <div className="relative mt-8 flex items-end justify-between gap-6 lg:col-span-4 lg:mt-0 lg:flex-col lg:items-stretch lg:justify-end">
          <p className="max-w-[17.5rem] text-[0.9375rem] leading-[1.55] text-ink/75 lg:order-2 lg:mt-8 lg:max-w-none">{text.note}</p>
          <div className="relative size-[4.75rem] shrink-0 lg:order-1 lg:size-32 lg:self-end" aria-hidden="true">
            <span className="absolute right-0 top-0 size-[72%] bg-sage" />
            <span className="absolute bottom-0 left-0 size-[46%] border border-forest" />
            <span className="absolute bottom-[14%] left-[32%] size-[24%] bg-blush" />
          </div>
        </div>
      </div>

      {/* Desktop only: the edition at a glance. On phones the stories are a thumb away. */}
      <ol className="mt-14 hidden grid-cols-5 border-t border-forest lg:grid">
        {edition.stories.map((s) => (
          <li key={s.id} className="border-r border-line last:border-r-0">
            <a href={`#story-${s.position}`} className="group block h-full px-4 pb-1 pt-4 first:pl-0">
              <span className="label tabular-nums text-earth">
                {two(s.position)} · {CATEGORIES[s.category].short}
              </span>
              <span className="mt-2 block font-display text-[1.0625rem] leading-[1.22] text-forest decoration-sage underline-offset-4 group-hover:underline">
                {s.headline}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
