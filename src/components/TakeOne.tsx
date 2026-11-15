import { useId, useState } from 'react'
import { readerStores, storyUrl, toggleSaved, useStore } from '../lib/reader'
import type { PublicEdition } from '../lib/types'
import { useReader } from './ReaderTools'
import { two } from './StoryParts'

/**
 * "Which one are you taking with you?" An optional last question on the back cover: pick one of the five,
 * then save it or share it. One pick per edition (remembered on this device); saving is separate, and a
 * reader can save as many stories as they like. No scores, no streaks, nothing to come back for.
 */
type ShareState = { kind: 'idle' } | { kind: 'copied' } | { kind: 'manual'; url: string } | { kind: 'shared' }

export function TakeOne({ edition }: { edition: PublicEdition }) {
  const reader = useReader()
  const favorites = readerStores().favorites
  const saved = readerStores().saved
  const picks = useStore(favorites)
  const savedList = useStore(saved)
  const [share, setShare] = useState<ShareState>({ kind: 'idle' })
  const id = useId()
  if (!reader?.interactive || edition.stories.length === 0) return null

  const pickedId = picks[edition.date]
  const picked = edition.stories.find((s) => s.id === pickedId) ?? null
  const isSaved = picked ? savedList.some((s) => s.id === picked.id) : false

  const choose = (storyId: string) => {
    favorites.set({ ...favorites.get(), [edition.date]: storyId })
    setShare({ kind: 'idle' })
  }
  const clear = () => {
    const next = { ...favorites.get() }
    delete next[edition.date]
    favorites.set(next)
    setShare({ kind: 'idle' })
  }

  async function shareIt() {
    if (!picked) return
    const url = storyUrl(edition.date, picked.position)
    const title = `${picked.headline} — The Good Five`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        setShare({ kind: 'shared' })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // they closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setShare({ kind: 'copied' })
    } catch {
      setShare({ kind: 'manual', url }) // no clipboard access: show the link to copy by hand
    }
  }

  return (
    <section aria-labelledby={`${id}-q`} className="mt-16 border-t border-chalk/25 pt-10 lg:mt-24">
      <fieldset>
        <legend id={`${id}-q`} className="display display-wonk text-[1.75rem] !leading-[1.12] !text-chalk sm:text-4xl">
          Which one are you taking with you?
        </legend>
        <p className="mt-3 max-w-[34rem] text-[0.9375rem] leading-relaxed text-chalk/75">Optional. Pick the story that stayed with you, then keep it or pass it on.</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 lg:max-w-[46rem]">
          {edition.stories.map((s) => {
            const on = s.id === pickedId
            return (
              <label key={s.id} className={`flex min-h-11 cursor-pointer items-start gap-3 border px-4 py-3 transition-colors ${on ? 'border-chalk bg-chalk text-forest' : 'border-chalk/30 text-chalk hover:border-chalk/70'}`}>
                <input type="radio" name={`${id}-pick`} value={s.id} checked={on} onChange={() => choose(s.id)} className="mt-1 size-4 shrink-0 accent-[#304d3c]" />
                <span className="min-w-0">
                  <span className={`label tabular-nums ${on ? 'text-earth' : 'text-sage-light'}`}>{two(s.position)}</span>
                  <span className="mt-0.5 block font-display text-[1.0625rem] leading-snug">{s.headline}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {picked && (
        <div className="mt-6 max-w-[46rem]" aria-live="polite">
          <p className="text-[0.9375rem] text-chalk">
            Your pick from this edition: <span className="font-semibold">story {picked.position}</span>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={isSaved}
              className="btn !border-chalk !text-chalk hover:!bg-forest-deep"
              onClick={() => saved.set(toggleSaved(saved.get(), { id: picked.id, date: edition.date, position: picked.position, headline: picked.headline, sourceName: picked.sourceName, category: picked.category }))}
            >
              {isSaved ? 'Saved to this device' : 'Save it'}
            </button>
            <button type="button" className="btn btn-solid !bg-chalk !text-forest hover:!bg-blush" onClick={() => void shareIt()}>
              Share a link
            </button>
            <button type="button" className="btn !border-transparent !text-chalk/75 underline underline-offset-4 hover:!bg-transparent hover:!text-chalk" onClick={clear}>
              Clear my pick
            </button>
          </div>
          <p className="mt-3 min-h-[1.5em] text-[0.875rem] text-chalk/80" role="status">
            {share.kind === 'copied' && 'Link copied. Paste it anywhere.'}
            {share.kind === 'shared' && 'Shared.'}
          </p>
          {share.kind === 'manual' && (
            <label className="mt-1 block text-[0.875rem] text-chalk/80">
              Copy this link:
              <input readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} className="field mt-1 !text-ink" />
            </label>
          )}
          <p className="mt-2 text-[0.8125rem] text-chalk/65">Your pick is one per edition. “Save it” adds it to your Saved stories, where you can keep as many as you like. Both stay on this device and browser.</p>
        </div>
      )}
    </section>
  )
}
