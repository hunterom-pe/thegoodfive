import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatLong, todayISO } from '../lib/dates'
import { useAsync, useTitle } from '../lib/hooks'
import type { EditionStatus, EditorEdition, EditorStory } from '../lib/types'
import { AddStoryForm } from './AddStoryForm'
import { editorRepo } from './editorRepo'
import { EDITION_SIZE, move, promote, reject, restore, swapWithBackup, type Lineup } from './lineup'
import { StatusBadge, StatusSteps } from './StatusBadge'
import { StoryReviewCard } from './StoryReviewCard'

const byPosition = (a: EditorStory, b: EditorStory) => (a.position ?? 0) - (b.position ?? 0)
const clip = (text: string, n = 38) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text)

/** Reasons this edition can't be published yet. Mirrors the database's own check. */
function blockers(primary: EditorStory[]): string[] {
  const issues: string[] = []
  if (primary.length !== EDITION_SIZE) issues.push(`The edition has ${primary.length} of 5 stories.`)
  primary.forEach((s, i) => {
    if (!s.headline.trim()) issues.push(`Story ${i + 1} has no headline.`)
    if (!s.summary.trim()) issues.push(`Story ${i + 1} has no summary.`)
    if (!/^https?:\/\//i.test(s.sourceUrl)) issues.push(`Story ${i + 1} has no link to the original.`)
  })
  return issues
}

function Editor({ edition, reload }: { edition: EditorEdition; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const primary = edition.stories.filter((s) => s.role === 'primary').sort(byPosition)
  const backup = edition.stories.filter((s) => s.role === 'backup').sort(byPosition)
  const rejected = edition.stories.filter((s) => s.role === 'rejected')
  const lineup: Lineup = { primary: primary.map((s) => s.id), backup: backup.map((s) => s.id) }
  const published = edition.status === 'published'
  const issues = blockers(primary)

  /** Run one change, then re-read the edition so the screen always shows what's stored. */
  async function act(change: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await change()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Nothing was changed.')
    }
    setBusy(false)
    reload()
  }
  const setLineup = (next: Lineup, rejection?: { id: string; reason: string }) => act(() => editorRepo.setLineup(edition.id, next, rejection))
  const setStatus = (status: EditionStatus) => act(() => editorRepo.setStatus(edition.id, status))
  const save = (story: EditorStory) => async (patch: Parameters<typeof editorRepo.updateStory>[2]) => {
    setError('')
    try {
      await editorRepo.updateStory(edition.id, story.id, patch)
      // Choosing an Unsplash photo must be reported to Unsplash (its API guidelines). Fire and forget.
      if (patch.imageSource === 'unsplash' && patch.imageUrl) void editorRepo.trackImageUse(story.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
      throw e
    }
    reload()
  }

  return (
    <div className="pb-28">
      <Link to="/editor" className="label inline-flex min-h-11 items-center text-earth hover:text-forest">
        ← All editions
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <h1 className="display text-[2rem] sm:text-[2.75rem]">{formatLong(edition.date)}</h1>
        <StatusBadge status={edition.status} />
      </div>
      <div className="mt-5">
        <StatusSteps status={edition.status} />
      </div>
      {edition.date > todayISO() && published && (
        <p className="mt-4 border-l-2 border-sage pl-3 text-[0.875rem] text-ink/70">Approved ahead of time. Readers will see it from {formatLong(edition.date)}.</p>
      )}

      {error && (
        <p role="alert" className="mt-5 border-l-2 border-earth bg-white py-2 pl-3 pr-2 text-[0.9375rem] text-earth">
          {error}
        </p>
      )}

      <section className="mt-9">
        <h2 className="label flex items-center justify-between border-b border-forest pb-2 text-forest">
          <span>The five</span>
          <span className={primary.length === EDITION_SIZE ? 'text-ink/70' : 'text-earth'}>
            {primary.length} / {EDITION_SIZE}
          </span>
        </h2>
        <ol className="mt-4 space-y-3">
          {primary.map((story, i) => (
            <StoryReviewCard
              key={story.id}
              story={story}
              locked={published}
              busy={busy}
              isFirst={i === 0}
              isLast={i === primary.length - 1}
              actions={{
                onSave: save(story),
                onMove: (direction) => setLineup(move(lineup, story.id, direction)),
                onReject: (reason) => setLineup(reject(lineup, story.id), { id: story.id, reason }),
                swap: {
                  label: 'Swap with a backup…',
                  options: backup.map((b) => ({ value: b.id, label: `B${b.position}: ${clip(b.headline)}` })),
                  onPick: (backupId) => setLineup(swapWithBackup(lineup, story.id, backupId)),
                },
              }}
            />
          ))}
        </ol>
        {primary.length < EDITION_SIZE && (
          <p className="mt-3 border border-dashed border-earth/60 p-4 text-[0.9375rem] text-earth">
            {EDITION_SIZE - primary.length} empty {EDITION_SIZE - primary.length === 1 ? 'slot' : 'slots'}. Add a story below to complete the edition.
          </p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="label border-b border-forest pb-2 text-forest">Backups ({backup.length})</h2>
        {backup.length === 0 && <p className="py-4 text-[0.9375rem] text-ink/70">No backups left for this edition.</p>}
        <ol className="mt-4 space-y-3">
          {backup.map((story) => (
            <StoryReviewCard
              key={story.id}
              story={story}
              locked={published}
              busy={busy}
              actions={{
                onSave: save(story),
                onReject: (reason) => setLineup(reject(lineup, story.id), { id: story.id, reason }),
                swap: {
                  label: 'Use in the edition…',
                  options: [
                    ...(primary.length < EDITION_SIZE ? [{ value: 'add', label: 'Add to the five' }] : []),
                    ...primary.map((p) => ({ value: p.id, label: `Replace ${p.position}: ${clip(p.headline, 30)}` })),
                  ],
                  onPick: (value) => setLineup(value === 'add' ? promote(lineup, story.id) : swapWithBackup(lineup, value, story.id)),
                },
              }}
            />
          ))}
        </ol>
      </section>

      {!published && (
        <AddStoryForm
          primaryCount={primary.length}
          backupCount={backup.length}
          onAdd={async (story) => {
            setError('')
            await editorRepo.addStory(edition.id, story)
            reload()
          }}
        />
      )}

      {rejected.length > 0 && (
        <section className="mt-12">
          <h2 className="label border-b border-line pb-2 text-ink/70">Rejected ({rejected.length})</h2>
          <ul>
            {rejected.map((story) => (
              <li key={story.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
                <span className="min-w-0 flex-1 basis-56">
                  <span className="block text-[0.9375rem] text-ink/70 line-through decoration-ink/30">{story.headline}</span>
                  <span className="mt-0.5 block text-[0.8125rem] text-ink/70">
                    {story.sourceName}
                    {story.rejectedReason && ` · “${story.rejectedReason}”`}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn btn-quiet" disabled={busy || published} onClick={() => setLineup(restore(lineup, story.id))}>
                    Restore as backup
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet !border-earth/50 !text-earth"
                    disabled={busy || published}
                    onClick={() => {
                      if (window.confirm('Permanently delete this story? This can’t be undone.')) void act(() => editorRepo.deleteStory(edition.id, story.id))
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Action bar: pinned to the thumb on phones */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-forest bg-chalk pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-[52rem] px-4 py-3 sm:px-8">
          {confirming ? (
            <div>
              <p className="text-[0.9375rem] leading-snug">
                <strong>Publish all five stories for {formatLong(edition.date)}?</strong> {edition.date > todayISO() ? 'Readers will see the edition from that date.' : 'Readers will see the edition straight away.'}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn btn-solid flex-1"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false)
                    void setStatus('published')
                  }}
                >
                  Yes, publish the edition
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : published ? (
            <div className="flex gap-2">
              <Link to={`/edition/${edition.date}`} className="btn flex-1">
                View live edition
              </Link>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setStatus('review')}>
                Unpublish to edit
              </button>
            </div>
          ) : (
            <>
              {issues.length > 0 && <p className="mb-2 text-[0.8125rem] font-semibold text-earth">{issues[0]}{issues.length > 1 && ` (+${issues.length - 1} more)`}</p>}
              <div className="flex gap-2">
                <Link to={`/editor/${edition.id}/preview`} className="btn btn-quiet !px-3">
                  Preview
                </Link>
                {edition.status === 'draft' ? (
                  <button type="button" className="btn !px-3" disabled={busy} onClick={() => setStatus('review')}>
                    Mark for review
                  </button>
                ) : (
                  <button type="button" className="btn !px-3" disabled={busy} onClick={() => setStatus('draft')}>
                    Back to draft
                  </button>
                )}
                <button type="button" className="btn btn-solid min-w-0 flex-1 !whitespace-normal leading-tight" disabled={busy || issues.length > 0} onClick={() => setConfirming(true)}>
                  Approve &amp; publish
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function EditionEditor() {
  const { id = '' } = useParams()
  const [state, reload] = useAsync(() => editorRepo.get(id), `editor:${id}`)
  // Keep showing the last good copy while a reload is in flight, so cards
  // (and any unsaved typing in them) are not torn down on every change.
  const [last, setLast] = useState<EditorEdition | null>(null)
  if (state.status === 'ready' && state.data && state.data !== last) setLast(state.data)
  const edition = last?.id === id ? last : null
  useTitle(edition ? `Edit ${formatLong(edition.date)}` : 'Editor')

  if (state.status === 'error' && !edition) {
    return (
      <p role="alert" className="border-l-2 border-earth pl-3 text-earth">
        {state.error}{' '}
        <button type="button" className="link-quiet font-semibold" onClick={reload}>
          Try again
        </button>
      </p>
    )
  }
  if (state.status === 'ready' && !state.data) {
    return (
      <p>
        That edition doesn’t exist.{' '}
        <Link to="/editor" className="link-quiet font-semibold text-forest">
          Back to all editions
        </Link>
      </p>
    )
  }
  if (!edition) return <p className="label text-earth">Loading edition…</p>
  return <Editor edition={edition} reload={reload} />
}
