import { Link } from 'react-router-dom'
import { FiveSquares, wrap } from '../components/Brand'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { two } from '../components/StoryParts'
import { CATEGORIES } from '../lib/categories'
import { formatLong } from '../lib/dates'
import { usePageMeta } from '../lib/hooks'
import { metaForPath } from '../lib/meta'
import { readerStores, sortSaved, storyPath, toggleSaved, useStore } from '../lib/reader'
import type { Category } from '../lib/types'

/** Stories saved on this device. Nothing here is sent anywhere; there are no accounts. */
export function SavedPage() {
  usePageMeta(metaForPath('/saved'))
  const store = readerStores().saved
  const saved = sortSaved(useStore(store))
  const persistent = store.persistent()
  const byDate = new Map<string, typeof saved>()
  for (const s of saved) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s])

  return (
    <>
      <SiteHeader />
      <main className={wrap}>
        <section className="pb-8 pt-8 sm:pt-12 lg:pb-12 lg:pt-20">
          <p className="label flex items-center gap-2.5 text-forest">
            <span className="size-2 bg-forest" aria-hidden="true" />
            Saved stories
          </p>
          <h1 className="display mt-5 max-w-[12em] text-[2.5rem] sm:text-[3.5rem] lg:text-[4.5rem]">The good things you kept.</h1>
          <p className="mt-5 max-w-[36rem] text-[1rem] leading-relaxed text-ink/75">
            Saved stories stay on this device, in this browser. There’s no account and nothing is sent anywhere, so they won’t follow you to another phone or computer, and clearing your browser’s data removes them.
          </p>
          {!persistent && (
            <p role="status" className="mt-4 max-w-[36rem] border-l-2 border-earth pl-3 text-[0.9375rem] text-earth">
              This browser isn’t letting the site keep anything (private browsing or blocked storage, perhaps), so saves last only until you close this page.
            </p>
          )}
        </section>

        {saved.length === 0 ? (
          <section className="border-t border-line py-12">
            <FiveSquares />
            <p className="display mt-6 text-[1.75rem] lg:text-[2.25rem]">Nothing saved yet.</p>
            <p className="mt-3 max-w-[30rem] text-[1rem] leading-relaxed text-ink/75">Under each story there’s a “Save story” button. Anything you save appears here, with a link back to the edition it ran in.</p>
            <p className="mt-6">
              <Link to="/" className="btn btn-solid">
                Read today’s five
              </Link>
            </p>
          </section>
        ) : (
          [...byDate].map(([date, items]) => (
            <section key={date} aria-labelledby={`saved-${date}`} className="border-t border-line py-8 lg:grid lg:grid-cols-12 lg:gap-12">
              <h2 id={`saved-${date}`} className="label text-earth lg:col-span-3 lg:pt-1.5">
                <time dateTime={date}>{formatLong(date)}</time>
              </h2>
              <ul className="mt-4 space-y-5 lg:col-span-9 lg:mt-0">
                {items.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="label tabular-nums text-forest">
                        {two(s.position)} <span className="text-sage-deep">/</span> 05
                        {s.category in CATEGORIES && <span className="ml-2 text-earth">{CATEGORIES[s.category as Category].short}</span>}
                      </p>
                      <Link to={storyPath(s.date, s.position)} className="mt-1.5 block font-display text-[1.375rem] leading-[1.18] text-forest decoration-sage underline-offset-4 hover:underline">
                        {s.headline}
                      </Link>
                      {s.sourceName && <p className="mt-1 text-[0.8125rem] text-ink/70">Reported by {s.sourceName}</p>}
                    </div>
                    <button
                      type="button"
                      className="shrink-0 min-h-11 px-2 text-[0.8125rem] font-semibold text-earth underline underline-offset-4 hover:text-forest"
                      onClick={() => store.set(toggleSaved(store.get(), s))}
                    >
                      Remove<span className="sr-only">: {s.headline}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
      <SiteFooter />
    </>
  )
}
