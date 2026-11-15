import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FiveSquares, wrap } from '../components/Brand'
import { DemoNotice } from '../components/EditionView'
import { PageLoading, PageMessage } from '../components/PageStates'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { two } from '../components/StoryParts'
import { publicRepo } from '../data/publicRepo'
import { CATEGORIES } from '../lib/categories'
import { formatMonthYear, todayISO } from '../lib/dates'
import { useAsync, usePageMeta } from '../lib/hooks'
import { metaForPath } from '../lib/meta'
import type { EditionSummary } from '../lib/types'

const weekday = (date: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`))

function EditionRow({ edition, isToday }: { edition: EditionSummary; isToday: boolean }) {
  const [lead, ...rest] = edition.stories
  return (
    <li className="border-t border-line">
      <Link to={`/edition/${edition.date}`} className="group grid grid-cols-[3.75rem_1fr] gap-x-4 py-7 sm:grid-cols-[6rem_1fr] lg:grid-cols-[8rem_1fr_1fr] lg:gap-x-12 lg:py-10">
        <div>
          <span className="display block text-[2.75rem] !leading-[0.85] tabular-nums lg:text-[4rem]">{two(Number(edition.date.slice(8)))}</span>
          <span className="label mt-2.5 block text-earth">{isToday ? 'Today' : weekday(edition.date)}</span>
        </div>
        <div>
          {lead && (
            <>
              <span className="label text-earth">{CATEGORIES[lead.category].short}</span>
              <h3 className="display mt-1.5 text-[1.5rem] !leading-[1.08] decoration-sage decoration-1 underline-offset-4 group-hover:underline lg:text-[2rem]">
                {lead.headline}
              </h3>
            </>
          )}
        </div>
        <ol className="col-start-2 mt-4 space-y-1.5 lg:col-start-3 lg:mt-0">
          {rest.map((s) => (
            <li key={s.position} className="flex gap-3 text-[0.875rem] leading-snug text-ink/75">
              <span className="w-4 shrink-0 font-semibold tabular-nums text-sage-deep">{s.position}</span>
              {s.headline}
            </li>
          ))}
        </ol>
      </Link>
    </li>
  )
}

export function ArchivePage() {
  usePageMeta(metaForPath('/archive'))
  const [state, retry] = useAsync(() => publicRepo.archive(), 'archive')
  const today = todayISO()

  // Older pages are appended on request: the archive can grow forever without one huge query.
  const [older, setOlder] = useState<EditionSummary[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle')
  const first = state.status === 'ready' ? state.data : null
  const editions = first ? [...first.items, ...older] : []
  const nextCursor = cursor === undefined ? (first?.nextCursor ?? null) : cursor

  async function loadMore() {
    setMore('loading')
    try {
      const page = await publicRepo.archive(nextCursor)
      setOlder((o) => [...o, ...page.items])
      setCursor(page.nextCursor)
      setMore('idle')
    } catch {
      setMore('error')
    }
  }

  const months = new Map<string, EditionSummary[]>()
  for (const e of editions) months.set(e.date.slice(0, 7), [...(months.get(e.date.slice(0, 7)) ?? []), e])

  return (
    <>
      <SiteHeader />
      <main>
        {editions.some((e) => e.isDemo) && <DemoNotice />}
        <section className={`${wrap} pb-10 pt-8 sm:pt-12 lg:pb-14 lg:pt-20`}>
          <p className="label flex items-center gap-2.5 text-forest">
            <span className="size-2 bg-forest" aria-hidden="true" />
            Archive
          </p>
          <div className="mt-5 flex items-end justify-between gap-6">
            <h1 className="display text-[2.875rem] sm:text-[4rem] lg:text-[5.75rem]">Every five, so far.</h1>
            <FiveSquares size={12} gap={6} className="mb-2 max-sm:hidden" />
          </div>
          <p className="mt-4 max-w-[26rem] text-[0.9375rem] leading-[1.55] text-ink/75">
            Past editions, kept exactly as they ran: the same five stories, in the same order, with their original sources.
          </p>
        </section>

        {state.status === 'loading' && <PageLoading label="Opening the archive…" />}
        {state.status === 'error' && (
          <PageMessage
            title="We couldn’t open the archive."
            action={
              <button type="button" className="btn btn-solid" onClick={retry}>
                Try again
              </button>
            }
          />
        )}
        {first && editions.length === 0 && <PageMessage title="Nothing here yet.">The first edition is on its way.</PageMessage>}

        <div className={`${wrap} pb-20 lg:pb-28`}>
          {[...months].map(([month, editions]) => (
            <section key={month} aria-labelledby={`m-${month}`} className="mt-6 first:mt-0">
              <h2 id={`m-${month}`} className="label flex items-center justify-between bg-forest px-3 py-2.5 text-chalk">
                <span>{formatMonthYear(`${month}-01`)}</span>
                <span className="tabular-nums text-sage-light">
                  {editions.length} {editions.length === 1 ? 'edition' : 'editions'}
                </span>
              </h2>
              <ul className="[&>li:first-child]:border-t-0">
                {editions.map((e) => (
                  <EditionRow key={e.id} edition={e} isToday={e.date === today} />
                ))}
              </ul>
            </section>
          ))}
          {nextCursor && (
            <div className="mt-10 text-center">
              <button type="button" className="btn" onClick={loadMore} disabled={more === 'loading'}>
                {more === 'loading' ? 'Loading…' : 'Load earlier editions'}
              </button>
              {more === 'error' && (
                <p role="alert" className="mt-3 text-[0.875rem] text-earth">
                  We couldn’t load more editions. Please try again.
                </p>
              )}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
