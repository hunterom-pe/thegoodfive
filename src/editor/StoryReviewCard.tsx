import { useState, type ReactNode } from 'react'
import { Arrow } from '../components/Brand'
import { two } from '../components/StoryParts'
import { CATEGORIES, CATEGORY_KEYS } from '../lib/categories'
import { formatShort } from '../lib/dates'
import { PhotoPanel } from './PhotoPanel'
import type { Category, EditorStory, StoryPatch } from '../lib/types'

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="label text-earth">{label}</span>
        {hint && <span className="text-[0.75rem] text-ink/70">{hint}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

export interface CardActions {
  onSave: (patch: StoryPatch) => Promise<void>
  onMove?: (direction: -1 | 1) => void
  onReject: (reason: string) => void
  searchPhotos?: (query: string) => Promise<import('../lib/types').ImageCandidate[]>
  /** For one of the five: swap with a backup. For a backup: take a slot. */
  swap?: { label: string; options: { value: string; label: string }[]; onPick: (value: string) => void }
}

export function StoryReviewCard({
  story,
  locked,
  busy,
  isFirst,
  isLast,
  actions,
}: {
  story: EditorStory
  /** Published editions keep their lineup; words can still be corrected. */
  locked: boolean
  busy: boolean
  isFirst?: boolean
  isLast?: boolean
  actions: CardActions
}) {
  const [open, setOpen] = useState(false)
  const [patch, setPatch] = useState<StoryPatch>({})
  const [saving, setSaving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const value = { ...story, ...patch }
  const dirty = Object.keys(patch).length > 0
  const set = <K extends keyof StoryPatch>(key: K, v: StoryPatch[K]) =>
    setPatch((p) => {
      const next = { ...p, [key]: v }
      if (v === story[key] || (v === '' && story[key] === null)) delete next[key]
      return next
    })

  const words = wordCount(value.summary)
  const wordsOk = words >= 60 && words <= 100
  const primary = story.role === 'primary'
  const panelId = `story-panel-${story.id}`

  /** Image changes save at once, and clear only the image edits from the pending patch. */
  async function applyImage(imagePatch: StoryPatch) {
    await actions.onSave(imagePatch)
    setPatch((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('image'))) as StoryPatch)
  }

  async function save() {
    setSaving(true)
    try {
      await actions.onSave(patch)
      setPatch({})
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="border border-line bg-white">
      {/* Summary row: always visible, tap to open */}
      <div className="flex items-stretch">
        <div className={`flex w-12 shrink-0 flex-col items-center justify-start pt-4 ${primary ? 'bg-forest text-chalk' : 'bg-mist text-forest'}`}>
          <span className="font-display text-[1.25rem] leading-none tabular-nums">{primary ? two(story.position ?? 0) : `B${story.position}`}</span>
        </div>
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 px-3.5 py-3.5 text-left">
          <span className="label flex flex-wrap items-center gap-x-2 gap-y-1 text-earth">
            {CATEGORIES[value.category].short}
            <span className="font-normal normal-case tracking-normal text-ink/70">
              {value.sourceName}
              {value.sourcePublishedAt && ` · ${formatShort(value.sourcePublishedAt)}`}
            </span>
            {story.imageUrl && (
              <span className={`px-1.5 py-0.5 text-[0.5625rem] ${story.imageRightsConfirmed ? 'bg-mist text-forest' : 'bg-blush text-forest-deep'}`}>
                {story.imageRightsConfirmed ? 'Photo approved' : 'Photo NOT approved'}
              </span>
            )}
            {dirty && <span className="bg-blush px-1.5 py-0.5 text-[0.5625rem] text-forest-deep">Unsaved</span>}
          </span>
          <span className="display mt-1.5 block text-[1.25rem] !leading-[1.15]">{value.headline || 'Untitled'}</span>
          <span className="mt-2 block text-[0.8125rem] font-semibold text-forest">{open ? 'Close' : 'Review & edit'}</span>
        </button>
      </div>

      {open && (
        <div id={panelId} className="border-t border-line">
        <fieldset disabled={locked} className="min-w-0 space-y-6 p-4 sm:p-5">
          {locked && <p className="border-l-2 border-sage pl-3 text-[0.8125rem] text-ink/70">Published and locked. Unpublish the edition to make corrections.</p>}
          {/* The research trail comes first: read the source before the copy. */}
          <section className="bg-mist p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="label text-forest">Check against the source</h4>
              <a href={value.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[0.875rem] font-semibold text-forest">
                <span className="link-quiet">Open the original</span>
                <span className="grid size-5 place-items-center bg-forest text-chalk">
                  <Arrow />
                </span>
              </a>
            </div>
            {story.originalTitle || story.originalExcerpt || story.aiRationale || story.claimsToCheck.length ? (
              <dl className="mt-2 space-y-3 text-[0.875rem] leading-relaxed">
                {story.originalTitle && (
                  <div>
                    <dt className="font-semibold">Original headline</dt>
                    <dd className="text-ink/80">{story.originalTitle}</dd>
                  </div>
                )}
                {story.originalExcerpt && (
                  <div>
                    <dt className="font-semibold">Retrieved text</dt>
                    <dd className="text-ink/80">{story.originalExcerpt}</dd>
                  </div>
                )}
                {story.claimsToCheck.length > 0 && (
                  <div>
                    <dt className="font-semibold">Claims to verify</dt>
                    <dd>
                      <ul className="mt-1 space-y-1">
                        {story.claimsToCheck.map((claim) => (
                          <li key={claim} className="flex gap-2.5 text-ink/80">
                            <span className="mt-[0.5em] size-1.5 shrink-0 bg-earth" aria-hidden="true" />
                            {claim}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {story.aiRationale && (
                  <div>
                    <dt className="font-semibold">Why the AI suggested it</dt>
                    <dd className="text-ink/80">{story.aiRationale}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-1 text-[0.875rem] text-ink/70">No research notes were stored with this story.</p>
            )}
            <p className="mt-3 border-t border-sage/60 pt-3 text-[0.75rem] leading-relaxed text-ink/70">The AI’s assessment is a starting point, not a fact-check. Read the original before you approve.</p>
          </section>

          <Field label="Headline">
            <textarea rows={2} className="field font-display text-[1.125rem] !leading-snug" value={value.headline} onChange={(e) => set('headline', e.target.value)} />
          </Field>
          <Field label="Summary" hint={<span className={wordsOk ? '' : 'font-semibold text-earth'}>{words} words · aim for 60–100</span>}>
            <textarea rows={7} className="field" value={value.summary} onChange={(e) => set('summary', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <select className="field" value={value.category} onChange={(e) => set('category', e.target.value as Category)}>
                {CATEGORY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {CATEGORIES[key].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source published">
              <input type="date" className="field" value={value.sourcePublishedAt?.slice(0, 10) ?? ''} onChange={(e) => set('sourcePublishedAt', e.target.value || null)} />
            </Field>
            <Field label="Publisher">
              <input className="field" value={value.sourceName} onChange={(e) => set('sourceName', e.target.value)} />
            </Field>
            <Field label="Original article URL">
              <input type="url" inputMode="url" className="field" value={value.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} />
            </Field>
          </div>

          {dirty && !locked && (
            <div className="flex flex-wrap gap-3 border-t border-line pt-5">
              <button type="button" className="btn btn-solid" onClick={save} disabled={saving || !value.headline.trim() || !value.summary.trim() || !value.sourceName.trim() || !/^https?:\/\//i.test(value.sourceUrl)}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setPatch({})} disabled={saving}>
                Discard
              </button>
            </div>
          )}
        </fieldset>
        {/* The photo panel stays usable on a published edition: it changes only the image, never the words. */}
        <div className="p-4 pt-0 sm:p-5 sm:pt-0">
          <PhotoPanel story={story} value={{ ...story, ...patch }} set={set} busy={busy || saving} onApply={applyImage} imageDirty={Object.keys(patch).some((k) => k.startsWith('image'))} onSaveManual={() => applyImage(Object.fromEntries(Object.entries(patch).filter(([k]) => k.startsWith('image'))) as StoryPatch)} searchPhotos={actions.searchPhotos} />
        </div>
        </div>
      )}

      {/* Lineup controls */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-chalk px-3 py-2.5">
        {locked ? (
          <p className="py-2 text-[0.8125rem] text-ink/70">Locked while published. Unpublish the edition to make changes.</p>
        ) : rejecting ? (
          <form
            className="flex w-full flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              actions.onReject(reason)
              setRejecting(false)
              setReason('')
            }}
          >
            <label className="min-w-0 flex-1 basis-56">
              <span className="label text-earth">Why reject it? (optional)</span>
              <input className="field mt-1.5" autoFocus value={reason} placeholder="e.g. misleading, not really good news" onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-solid" disabled={busy}>
              Reject story
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            {actions.onMove && (
              <>
                <button type="button" className="btn btn-quiet w-11 !px-0" aria-label="Move up" disabled={busy || isFirst} onClick={() => actions.onMove!(-1)}>
                  ↑
                </button>
                <button type="button" className="btn btn-quiet w-11 !px-0" aria-label="Move down" disabled={busy || isLast} onClick={() => actions.onMove!(1)}>
                  ↓
                </button>
              </>
            )}
            {actions.swap && actions.swap.options.length > 0 && (
              <select
                className="field h-11 w-auto min-w-0 flex-1 !py-0 text-[0.875rem] font-semibold sm:flex-none"
                aria-label={actions.swap.label}
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && actions.swap!.onPick(e.target.value)}
              >
                <option value="">{actions.swap.label}</option>
                {actions.swap.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-quiet ml-auto !border-earth/50 !text-earth" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </button>
          </>
        )}
      </div>
    </li>
  )
}
