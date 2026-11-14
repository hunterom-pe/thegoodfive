import { useState } from 'react'
import { Arrow } from '../components/Brand'
import type { EditorStory, ImageCandidate, ImageKind, StoryPatch } from '../lib/types'

const SOURCE_LABEL: Record<string, string> = {
  'og:image': 'Article page (Open Graph)',
  'twitter:image': 'Article page (Twitter card)',
  'json-ld': 'Article page (structured data)',
  rss: 'The publisher’s feed',
  unsplash: 'Unsplash',
  manual: 'Added by hand',
  sample: 'Sample content',
}

export const KIND_LABEL: Record<ImageKind, string> = {
  original: 'Article’s original image',
  illustrative: 'Illustrative photo (not from the event)',
}

const CLEAR: StoryPatch = {
  imageUrl: null, imageAlt: null, imageCredit: null, imageCreditUrl: null, imageLicense: null,
  imageKind: null, imageSource: null, imageSourceUrl: null, imageRightsConfirmed: false, imageEditorApproved: false,
}

/** Switching to a candidate. A licensed provider's photo is cleared by its licence; a publisher's image never is. */
export function candidatePatch(c: ImageCandidate): StoryPatch {
  return {
    imageUrl: c.url, imageAlt: c.alt, imageCredit: c.credit, imageCreditUrl: c.creditUrl, imageLicense: c.license,
    imageKind: c.kind, imageSource: c.source, imageSourceUrl: c.sourceUrl,
    imageRightsConfirmed: c.source === 'unsplash',
    // A person picked this photo, which is what Unsplash's terms ask for and what lets it appear in an automatically published edition.
    imageEditorApproved: true,
  }
}

function Thumb({ url, alt, className = '' }: { url: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div className={`grid place-items-center bg-mist px-2 text-center text-[0.75rem] text-ink/70 ${className}`}>Image didn’t load</div>
  // Unsplash links are sized on demand; other hosts are shown as they are.
  const src = url.startsWith('https://images.unsplash.com/') ? `${url}${url.includes('?') ? '&' : '?'}w=600&auto=format&fit=crop&q=70` : url
  return <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`bg-mist object-cover ${className}`} />
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label text-earth">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

/**
 * Photo review for one story. Shows what is selected, where it came from, who
 * to credit, what licence covers it, and whether readers will see it. Nothing
 * here can make a publisher's image public without an explicit approval.
 */
export function PhotoPanel({
  story,
  value,
  set,
  onApply,
  busy,
  imageDirty,
  onSaveManual,
  searchPhotos,
}: {
  /** The saved story: status and provenance always reflect what is stored. */
  story: EditorStory
  /** The story with any unsaved edits, for the manual fields. */
  value: EditorStory
  set: <K extends keyof StoryPatch>(key: K, v: StoryPatch[K]) => void
  /** Save image changes immediately. */
  onApply: (patch: StoryPatch) => Promise<void>
  busy: boolean
  /** Unsaved edits in the manual image fields. */
  imageDirty: boolean
  onSaveManual: () => Promise<void>
  /** An editor's own photo search. Absent when searching is unavailable. */
  searchPhotos?: (query: string) => Promise<ImageCandidate[]>
}) {
  const [confirm, setConfirm] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ImageCandidate[] | null>(null)
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  async function runSearch() {
    if (!searchPhotos) return
    setSearchState('searching')
    setSearchError('')
    try {
      setResults(await searchPhotos(query))
      setSearchState('idle')
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Photo search failed.')
      setSearchState('error')
    }
  }
  const [working, setWorking] = useState(false)
  const apply = async (patch: StoryPatch) => {
    setWorking(true)
    try {
      await onApply(patch)
      setConfirm(false)
    } finally {
      setWorking(false)
    }
  }
  const has = Boolean(story.imageUrl)
  const approved = has && story.imageRightsConfirmed
  const licensedProvider = story.imageSource === 'unsplash'
  const others = story.imageCandidates.filter((c) => c.url !== story.imageUrl)
  const disabled = busy || working

  return (
    <div className="border-t border-line pt-5">
      <p className="label mb-3 text-forest">Photograph</p>

      {!has ? (
        <p className="border border-dashed border-line p-3 text-[0.875rem] text-ink/70">No photo selected. Readers see the square artwork. Choose a candidate below or add your own.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[13rem_1fr]">
          <Thumb url={story.imageUrl!} alt={story.imageAlt ?? ''} className="aspect-[3/2] w-full" />
          <div className="min-w-0 space-y-2.5 text-[0.875rem] leading-relaxed">
            <p className={`label inline-flex items-center gap-2 border px-2 py-1.5 ${approved ? 'border-forest bg-forest text-chalk' : 'border-earth bg-blush/40 text-forest-deep'}`}>
              <span className={`size-1.5 ${approved ? 'bg-blush' : 'bg-earth'}`} aria-hidden="true" />
              {approved ? 'Approved for public' : 'NOT APPROVED · hidden from readers'}
            </p>
            <dl className="space-y-1">
              <div>
                <dt className="inline font-semibold">Type: </dt>
                <dd className="inline">{story.imageKind ? KIND_LABEL[story.imageKind] : 'Not specified'}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">Source: </dt>
                <dd className="inline">{SOURCE_LABEL[story.imageSource ?? ''] ?? story.imageSource ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">Credit: </dt>
                <dd className="inline">
                  {story.imageCredit ? (
                    story.imageCreditUrl ? (
                      <a href={story.imageCreditUrl} target="_blank" rel="noopener noreferrer" className="link-quiet font-semibold text-forest">
                        {story.imageCredit}
                      </a>
                    ) : (
                      story.imageCredit
                    )
                  ) : (
                    <span className="text-earth">none recorded</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold">Licence: </dt>
                <dd className="inline">{story.imageLicense ?? <span className="font-semibold text-earth">Not established. Confirm permission before approving.</span>}</dd>
              </div>
            </dl>
            {story.imageSourceUrl && (
              <a href={story.imageSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-forest">
                <span className="link-quiet">Open the image page</span>
                <span className="grid size-5 place-items-center bg-forest text-chalk">
                  <Arrow />
                </span>
              </a>
            )}

            {approved && !story.imageEditorApproved && licensedProvider && (
              <p className="border-l-2 border-sage pl-3 text-[0.8125rem] text-ink/75">
                Cleared by Unsplash’s licence, but not yet approved by you. If this edition publishes automatically, this photo is left out (Unsplash asks for a person to choose its photos). Approve it to keep it.
              </p>
            )}
            {approved ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => apply({ imageRightsConfirmed: false, imageEditorApproved: false })}>
                  Withdraw approval
                </button>
              </div>
            ) : (
              <div className="space-y-2 border-l-2 border-earth pl-3">
                <p className="text-[0.8125rem] text-ink/75">
                  {licensedProvider
                    ? 'This photo comes from Unsplash, whose licence covers it. Approve it to show it to readers.'
                    : 'Finding an image on a page does not give us the right to publish it. Approve it only if you have permission from the rights holder, or the licence allows reuse.'}
                </p>
                <label className="flex min-h-11 items-center gap-3 text-[0.875rem]">
                  <input type="checkbox" className="size-5 accent-forest" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  I’ve confirmed we have the right to publish this image
                </label>
                <button type="button" className="btn btn-solid" disabled={disabled || !confirm} onClick={() => apply({ imageRightsConfirmed: true, imageEditorApproved: true })}>
                  Approve for public use
                </button>
              </div>
            )}
            <button type="button" className="btn btn-quiet !border-earth/50 !text-earth" disabled={disabled} onClick={() => apply(CLEAR)}>
              Remove image
            </button>
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-5">
          <p className="label text-earth">Other options</p>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {others.map((c) => (
              <li key={c.url} className="flex gap-3 border border-line p-2">
                <Thumb url={c.url} alt={c.alt ?? ''} className="aspect-[3/2] w-24 shrink-0" />
                <div className="min-w-0 text-[0.8125rem] leading-snug">
                  <p className="font-semibold">{c.kind === 'original' ? 'Article’s own image' : 'Illustrative · Unsplash'}</p>
                  <p className="truncate text-ink/70">{c.credit ?? 'No credit'}</p>
                  <p className={c.kind === 'original' ? 'text-earth' : 'text-ink/70'}>{c.kind === 'original' ? 'Rights not established' : 'Licence covers this photo'}</p>
                  <button type="button" className="mt-1 min-h-11 font-semibold text-forest underline underline-offset-4 disabled:opacity-40" disabled={disabled} onClick={() => apply(candidatePatch(c))}>
                    Use this image
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {searchPhotos && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="label text-earth">Find a licensed photo</p>
          <p className="mt-1 text-[0.8125rem] text-ink/70">Search Unsplash yourself and choose the photo. Photos are labelled illustrative and credited automatically.</p>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void runSearch()
            }}
          >
            <input className="field min-w-0 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. coral reef fish underwater" aria-label="Search for a photo" />
            <button type="submit" className="btn" disabled={disabled || query.trim().length < 3 || searchState === 'searching'}>
              {searchState === 'searching' ? 'Searching…' : 'Search'}
            </button>
          </form>
          {searchState === 'error' && (
            <p role="alert" className="mt-2 border-l-2 border-earth pl-3 text-[0.8125rem] text-earth">
              {searchError}
            </p>
          )}
          {results && results.length === 0 && <p className="mt-2 text-[0.8125rem] text-ink/70">No photos found. Try different words.</p>}
          {results && results.length > 0 && (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {results.map((c) => (
                <li key={c.url} className="flex gap-3 border border-line p-2">
                  <Thumb url={c.url} alt={c.alt ?? ''} className="aspect-[3/2] w-24 shrink-0" />
                  <div className="min-w-0 text-[0.8125rem] leading-snug">
                    <p className="truncate font-semibold">{c.credit ?? 'Unsplash'}</p>
                    <p className="line-clamp-2 text-ink/70">{c.alt}</p>
                    <button
                      type="button"
                      className="mt-1 min-h-11 font-semibold text-forest underline underline-offset-4 disabled:opacity-40"
                      disabled={disabled}
                      onClick={() => apply({ ...candidatePatch(c), imageCandidates: [...story.imageCandidates.filter((x) => x.url !== c.url), c] })}
                    >
                      Use this photo
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="mt-5 border-t border-line pt-3">
        <summary className="label flex min-h-11 cursor-pointer items-center text-forest">Replace with your own image</summary>
        <p className="text-[0.8125rem] leading-relaxed text-ink/70">A preview image on a news site is not permission to reuse it. Without confirmed rights, readers see the square artwork instead.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Image URL">
            <input
              type="url"
              inputMode="url"
              className="field"
              value={value.imageUrl ?? ''}
              onChange={(e) => {
                set('imageUrl', e.target.value || null)
                set('imageSource', e.target.value ? 'manual' : null)
              }}
            />
          </Field>
          <Field label="Alt text">
            <input className="field" value={value.imageAlt ?? ''} onChange={(e) => set('imageAlt', e.target.value || null)} />
          </Field>
          <Field label="Credit">
            <input className="field" value={value.imageCredit ?? ''} onChange={(e) => set('imageCredit', e.target.value || null)} />
          </Field>
          <Field label="Credit link">
            <input type="url" inputMode="url" className="field" value={value.imageCreditUrl ?? ''} onChange={(e) => set('imageCreditUrl', e.target.value || null)} />
          </Field>
          <Field label="Licence">
            <input className="field" placeholder="e.g. CC BY 4.0, public domain" value={value.imageLicense ?? ''} onChange={(e) => set('imageLicense', e.target.value || null)} />
          </Field>
          <Field label="This photo is">
            <select className="field" value={value.imageKind ?? ''} onChange={(e) => set('imageKind', (e.target.value || null) as ImageKind | null)}>
              <option value="">Not specified</option>
              <option value="original">A photo of the reported event or subject</option>
              <option value="illustrative">Illustrative (representative only)</option>
            </select>
          </Field>
        </div>
        <label className="mt-4 flex min-h-11 items-center gap-3 text-[0.9375rem]">
          <input type="checkbox" className="size-5 accent-forest" checked={value.imageRightsConfirmed} disabled={!value.imageUrl} onChange={(e) => {
              set('imageRightsConfirmed', e.target.checked)
              set('imageEditorApproved', e.target.checked)
            }} />
          I’ve confirmed we have the right to publish this image
        </label>
        <button type="button" className="btn mt-3" disabled={busy || !imageDirty} onClick={() => void onSaveManual()}>
          Save image details
        </button>
      </details>
    </div>
  )
}
