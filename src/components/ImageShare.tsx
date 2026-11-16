import { useEffect, useId, useRef, useState } from 'react'
import { canvasToPng, drawKeepsake, drawStoryCard, imageFilename, shareImageFile, SIZES, type CardFormat } from '../lib/cards'
import { formatLong } from '../lib/dates'
import { storyUrl } from '../lib/reader'
import type { PublicEdition, PublicStory } from '../lib/types'

/**
 * Preview, share or download a branded image of a story (square or portrait) or an edition keepsake. Drawn in
 * this browser; nothing is uploaded. Native file sharing where the device offers it; otherwise download the image
 * and copy the link.
 */
type What = { kind: 'story'; story: PublicStory; edition: PublicEdition } | { kind: 'edition'; edition: PublicEdition }

const FONTS = ['420 64px "Fraunces Variable"', '480 46px "Fraunces Variable"', '500 30px "DM Sans Variable"', '600 24px "DM Sans Variable"']

async function render(what: What, format: CardFormat): Promise<Blob> {
  // The card uses the site's own fonts: wait for them, or the first image would be drawn in a fallback face.
  try {
    await Promise.all(FONTS.map((f) => document.fonts?.load(f)))
  } catch {
    /* fall back to the system fonts named in the card's font stacks */
  }
  const size = what.kind === 'edition' ? SIZES.keepsake : SIZES[format]
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not draw the image.')
  const host = 'thegoodfive.netlify.app'
  if (what.kind === 'story') {
    const { story, edition } = what
    drawStoryCard(ctx, { headline: story.headline, position: story.position, category: story.category, sourceName: story.sourceName, dateLabel: formatLong(edition.date), linkLabel: `${host}/edition/${edition.date}#story-${story.position}` }, format)
  } else {
    drawKeepsake(ctx, { date: what.edition.date, dateLabel: formatLong(what.edition.date), stories: what.edition.stories, linkLabel: `${host}/edition/${what.edition.date}` })
  }
  return canvasToPng(canvas)
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function ImageShareButton({ what, label, className = '' }: { what: What; label: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<CardFormat>('square')
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null)
  const [state, setState] = useState<'idle' | 'drawing' | 'error'>('idle')
  const [note, setNote] = useState('')
  const [manualLink, setManualLink] = useState('')
  const id = useId()

  const url = what.kind === 'story' ? storyUrl(what.edition.date, what.story.position) : storyUrl(what.edition.date, 1).replace(/#story-1$/, '')
  const title = what.kind === 'story' ? `${what.story.headline} — The Good Five` : `The Good Five, ${formatLong(what.edition.date)}`
  const filename = what.kind === 'story' ? imageFilename('story', what.edition.date, what.story.headline) : imageFilename('edition', what.edition.date)
  const alt =
    what.kind === 'story'
      ? `Share card: “${what.story.headline}”, story ${what.story.position} of 5 from ${formatLong(what.edition.date)}, reported by ${what.story.sourceName}.`
      : `Keepsake for ${formatLong(what.edition.date)}: the edition’s cover of five squares and its five headlines.`

  useEffect(() => {
    if (!open) return
    let live = true
    let made: string | null = null
    setState('drawing')
    setNote('')
    render(what, format).then(
      (blob) => {
        if (!live) return
        made = URL.createObjectURL(blob)
        setImage({ blob, url: made })
        setState('idle')
      },
      (e: unknown) => {
        if (!live) return
        setImage(null)
        setState('error')
        setNote(e instanceof Error ? e.message : 'The image could not be made.')
      },
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format])

  const show = () => {
    setOpen(true)
    setManualLink('')
    dialog.current?.showModal()
  }
  const close = () => {
    dialog.current?.close()
  }

  async function share() {
    if (!image) return
    const outcome = await shareImageFile(image.blob, filename, { title, url })
    if (outcome === 'shared') setNote('Shared.')
    else if (outcome === 'cancelled') setNote('')
    else {
      download(image.blob, filename)
      setNote(outcome === 'unsupported' ? 'This browser can’t share images directly, so the image was downloaded instead. Copy the link to go with it.' : 'Sharing didn’t work, so the image was downloaded instead.')
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setNote('Link copied.')
      setManualLink('')
    } catch {
      setManualLink(url)
      setNote('')
    }
  }

  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
  return (
    <>
      <button ref={opener} type="button" onClick={show} className={className}>
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-t`}
        onClose={() => {
          setOpen(false)
          opener.current?.focus()
        }}
        onClick={(e) => e.target === dialog.current && close()}
        className="m-auto max-h-[calc(100dvh-1rem)] w-[min(40rem,calc(100vw-1rem))] overflow-auto border border-line bg-chalk p-0 text-ink backdrop:bg-ink/60"
      >
        <div className="p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={`${id}-t`} className="display text-[1.5rem] sm:text-[1.75rem]">
              {what.kind === 'story' ? 'Share this story' : 'This edition’s keepsake'}
            </h2>
            <button type="button" onClick={close} aria-label="Close" className="grid size-11 shrink-0 place-items-center text-ink/70 hover:text-forest">
              <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {what.kind === 'story' && (
            <fieldset className="mt-3 flex gap-2">
              <legend className="sr-only">Image shape</legend>
              {(['square', 'portrait'] as const).map((f) => (
                // The real radio is visually hidden, so its label shows the keyboard focus (the site's own focus ring).
                <label key={f} className={`btn !min-h-11 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-forest ${format === f ? 'btn-solid' : 'btn-quiet'}`}>
                  <input type="radio" name={`${id}-f`} value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
                  {f === 'square' ? 'Square' : 'Portrait (for stories)'}
                </label>
              ))}
            </fieldset>
          )}

          <div className="mt-4 grid place-items-center bg-mist p-3" aria-busy={state === 'drawing'}>
            {image ? (
              <img src={image.url} alt={alt} className={`h-auto max-h-[55dvh] w-auto max-w-full border border-line ${what.kind === 'story' && format === 'portrait' ? 'aspect-[9/16]' : ''}`} />
            ) : (
              <p className="py-16 text-[0.9375rem] text-ink/70">{state === 'error' ? 'The image couldn’t be made in this browser.' : 'Drawing the image…'}</p>
            )}
          </div>

          {what.kind === 'edition' && (
            <div className="mt-4">
              <p className="label text-earth">In this edition</p>
              <ol className="mt-2 space-y-1 text-[0.9375rem] leading-snug">
                {what.edition.stories.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="w-5 shrink-0 font-semibold tabular-nums text-sage-deep">{s.position}</span>
                    {s.headline}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {canShareFiles && (
              <button type="button" className="btn btn-solid" disabled={!image} onClick={() => void share()}>
                Share image
              </button>
            )}
            <button type="button" className={`btn ${canShareFiles ? '' : 'btn-solid'}`} disabled={!image} onClick={() => image && download(image.blob, filename)}>
              Download image
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void copyLink()}>
              Copy link
            </button>
          </div>
          <p role="status" className="mt-3 min-h-[1.25em] text-[0.875rem] text-forest">
            {note}
          </p>
          {manualLink && (
            <label className="block text-[0.875rem] text-ink/75">
              Copy this link:
              <input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} className="field mt-1" />
            </label>
          )}
          <p className="mt-2 text-[0.8125rem] text-ink/65">Made on this device from the edition’s own words; nothing is uploaded. The image links to {what.kind === 'story' ? 'this story' : 'this edition'}: {url.replace('https://', '')}</p>
        </div>
      </dialog>
    </>
  )
}
