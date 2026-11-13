import { useState, type FormEvent, type ReactNode } from 'react'
import { CATEGORIES, CATEGORY_KEYS } from '../lib/categories'
import type { Category, NewStory } from '../lib/types'
import { wordCount } from './StoryReviewCard'
import { validateStory } from './validate'

const blank = { headline: '', summary: '', sourceName: '', sourceUrl: '', published: '', imageUrl: '', imageAlt: '', imageCredit: '', imageLicense: '' }

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="label text-earth">{label}</span>
        {hint && <span className="text-[0.75rem] text-ink/60">{hint}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

/** Add a story by hand. Phase 3's generated stories will land in the same lineup. */
export function AddStoryForm({ primaryCount, backupCount, onAdd }: { primaryCount: number; backupCount: number; onAdd: (story: NewStory) => Promise<void> }) {
  const primaryOpen = primaryCount < 5
  const backupOpen = backupCount < 3
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(blank)
  const [category, setCategory] = useState<Category>('humanity')
  const [role, setRole] = useState<'primary' | 'backup'>(primaryOpen ? 'primary' : 'backup')
  const [rights, setRights] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [key]: e.target.value }))

  // If the chosen slot type has filled up, fall back to the other.
  const effectiveRole = role === 'primary' && !primaryOpen ? 'backup' : role

  if (!primaryOpen && !backupOpen) {
    return <p className="mt-12 border border-dashed border-line p-4 text-[0.875rem] text-ink/60">The edition has five stories and three backups. Reject or swap one to make room for another.</p>
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const story: NewStory = {
      role: effectiveRole,
      category,
      headline: f.headline.trim(),
      summary: f.summary.trim(),
      sourceName: f.sourceName.trim(),
      sourceUrl: f.sourceUrl.trim(),
      sourcePublishedAt: f.published || null,
      imageUrl: f.imageUrl.trim() || null,
      imageAlt: f.imageAlt.trim() || null,
      imageCredit: f.imageCredit.trim() || null,
      imageLicense: f.imageLicense.trim() || null,
      imageRightsConfirmed: rights,
    }
    const problem = validateStory(story)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      await onAdd(story)
      setF(blank)
      setRights(false)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The story could not be added.')
    }
    setBusy(false)
  }

  const words = wordCount(f.summary)
  return (
    <section className="mt-12">
      <h2 className="label border-b border-forest pb-2 text-forest">Add a story</h2>
      {!open ? (
        <button type="button" className="btn mt-4" onClick={() => setOpen(true)}>
          + Add a story by hand
        </button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-5 border border-line bg-white p-4 sm:p-5" noValidate>
          <Field label="Goes in">
            <select className="field" value={effectiveRole} onChange={(e) => setRole(e.target.value as 'primary' | 'backup')}>
              <option value="primary" disabled={!primaryOpen}>
                The five ({primaryCount} of 5 filled)
              </option>
              <option value="backup" disabled={!backupOpen}>
                Backups ({backupCount} of 3 filled)
              </option>
            </select>
          </Field>
          <Field label="Headline">
            <textarea rows={2} className="field font-display text-[1.125rem] !leading-snug" value={f.headline} onChange={set('headline')} />
          </Field>
          <Field label="Summary" hint={<span className={words >= 60 && words <= 100 ? '' : 'text-earth'}>{words} words · aim for 60–100</span>}>
            <textarea rows={6} className="field" value={f.summary} onChange={set('summary')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <select className="field" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {CATEGORIES[key].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source published">
              <input type="date" className="field" value={f.published} onChange={set('published')} />
            </Field>
            <Field label="Publisher">
              <input className="field" value={f.sourceName} onChange={set('sourceName')} />
            </Field>
            <Field label="Original article URL">
              <input type="url" inputMode="url" placeholder="https://" className="field" value={f.sourceUrl} onChange={set('sourceUrl')} />
            </Field>
          </div>
          <details className="border-t border-line pt-4">
            <summary className="label flex min-h-11 cursor-pointer items-center text-forest">Photograph (optional)</summary>
            <p className="text-[0.8125rem] leading-relaxed text-ink/60">A preview image on a news site is not permission to reuse it. Without confirmed rights, readers see the square composition instead.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Image URL">
                <input type="url" inputMode="url" placeholder="https://" className="field" value={f.imageUrl} onChange={set('imageUrl')} />
              </Field>
              <Field label="Alt text">
                <input className="field" value={f.imageAlt} onChange={set('imageAlt')} />
              </Field>
              <Field label="Credit">
                <input className="field" value={f.imageCredit} onChange={set('imageCredit')} />
              </Field>
              <Field label="Licence">
                <input className="field" value={f.imageLicense} onChange={set('imageLicense')} />
              </Field>
            </div>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-[0.9375rem]">
              <input type="checkbox" className="size-5 accent-forest" checked={rights} disabled={!f.imageUrl.trim()} onChange={(e) => setRights(e.target.checked)} />
              I’ve confirmed we have the right to publish this image
            </label>
          </details>
          {error && (
            <p role="alert" className="border-l-2 border-earth pl-3 text-[0.875rem] text-earth">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button type="submit" className="btn btn-solid" disabled={busy}>
              {busy ? 'Adding…' : 'Add story'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
