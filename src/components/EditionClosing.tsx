import { Link } from 'react-router-dom'
import { formatLong, formatWeekday } from '../lib/dates'
import type { PublicEdition } from '../lib/types'
import { FiveSquares, wrap } from './Brand'
import type { EditionContext } from './EditionHero'
import { Reveal } from './Reveal'
import { TakeOne } from './TakeOne'
import { KeepsakeButton } from './ReaderTools'

/** The back cover. Five squares, three lines, and one optional question. Nothing asks the reader to come back. */
export function EditionClosing({ edition, context }: { edition: PublicEdition; context: EditionContext }) {
  const kicker =
    context === 'today' ? 'That’s your five for today.' : context === 'latest' ? 'That’s the latest five.' : `That was the five for ${formatWeekday(edition.date)}.`
  return (
    <section aria-label="End of edition" data-edition-end className="on-dark bg-forest text-chalk">
      <div className={`${wrap} pb-8 pt-20 lg:pb-10 lg:pt-36`}>
        <Reveal variant="closing">
          <FiveSquares onDark size={14} gap={7} />
          <p data-c="1" className="label mt-10 text-sage-light">{kicker}</p>
          <h2 data-c="2" className="display mt-5 max-w-[9em] text-[3.25rem] !leading-[0.98] !text-chalk sm:text-7xl lg:text-[7rem]">See? Good things are happening.</h2>
          <p data-c="3" className="display display-wonk mt-6 text-[1.625rem] !leading-[1.15] !text-blush sm:text-4xl lg:mt-8 lg:text-[2.75rem]">
            {context === 'archive' ? (
              <>
                There are five more waiting.{' '}
                <Link to="/" className="underline decoration-blush/50 decoration-1 underline-offset-[0.18em] hover:decoration-blush">
                  Read the latest edition.
                </Link>
              </>
            ) : context === 'today' ? (
              'Come back tomorrow. We’ll find five more.'
            ) : (
              'Come back soon. We’re finding five more.'
            )}
          </p>
        </Reveal>
        <TakeOne edition={edition} />
        <KeepsakeButton edition={edition} />
        <div className="label mt-20 flex items-center justify-between gap-4 border-t border-chalk/25 pt-5 text-chalk/70 lg:mt-32">
          <span>The Good Five</span>
          <time dateTime={edition.date} className="text-right">
            {formatLong(edition.date)}
          </time>
        </div>
      </div>
    </section>
  )
}
