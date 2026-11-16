import { useCallback, useEffect, useId, useState } from 'react'
import { formatLong } from '../lib/dates'
import type { EditorStory } from '../lib/types'
import { supabase } from './supabaseClient'

/**
 * "What happened next?" for one story: link it to an earlier story it follows up, with a reason and a source,
 * then approve it. Everything goes through the database's own checks (editor only, pending until approved,
 * no self/duplicate/backwards links): see supabase/migrations/20261119000000_story_followups.sql.
 */
interface Link {
  id: string
  status: 'pending' | 'approved'
  explanation: string
  source_url: string
  earlier_story: string
  later_story: string
  other: { headline: string; position: number | null; date: string } | null
}
interface Candidate {
  id: string
  headline: string
  position: number | null
  role: string
}

const friendly = (message: string) =>
  /story_followups_once|duplicate key/.test(message)
    ? 'These two stories are already linked.'
    : /not_self/.test(message)
      ? 'A story can’t follow up itself.'
      : /explanation/.test(message)
        ? 'Write a reason of at least 20 characters.'
        : /source_url/.test(message)
          ? 'The source must be an https:// link.'
          : /story_followups|relation .* does not exist/.test(message) && /does not exist/.test(message)
            ? 'Follow-ups aren’t set up yet. Run the newest database migration.'
            : message

export function FollowUpsPanel({ story, editionDate }: { story: EditorStory; editionDate: string }) {
  const [links, setLinks] = useState<Link[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState('')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [earlier, setEarlier] = useState('')
  const [explanation, setExplanation] = useState('')
  const [source, setSource] = useState('')
  const id = useId()

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('story_followups')
      .select('id, status, explanation, source_url, earlier_story, later_story')
      .or(`earlier_story.eq.${story.id},later_story.eq.${story.id}`)
    if (error) {
      setError(friendly(error.message))
      setLinks([])
      return
    }
    const others = [...new Set((data ?? []).map((l) => (l.earlier_story === story.id ? l.later_story : l.earlier_story)))]
    const { data: rows } = others.length
      ? await supabase.from('stories').select('id, headline, position, editions(edition_date)').in('id', others)
      : { data: [] as { id: string; headline: string; position: number | null; editions: { edition_date: string } | null }[] }
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r as unknown as { headline: string; position: number | null; editions: { edition_date: string } | null }]))
    setLinks(
      (data ?? []).map((l) => {
        const o = byId.get(l.earlier_story === story.id ? l.later_story : l.earlier_story)
        return { ...(l as Omit<Link, 'other'>), other: o ? { headline: o.headline, position: o.position, date: o.editions?.edition_date ?? '' } : null }
      }),
    )
  }, [story.id])

  useEffect(() => {
    void load()
  }, [load])

  async function findStories() {
    if (!supabase || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    setError('')
    const { data, error } = await supabase.from('stories').select('id, headline, position, role, editions!inner(edition_date)').eq('editions.edition_date', date).neq('role', 'rejected').order('position')
    if (error) setError(friendly(error.message))
    setCandidates((data ?? []).map((r) => ({ id: r.id as string, headline: r.headline as string, position: r.position as number | null, role: r.role as string })))
    setEarlier('')
  }

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true)
    setError('')
    const { error } = await fn()
    if (error) setError(friendly(error.message))
    await load()
    setBusy(false)
    return !error
  }

  if (!supabase) return null
  const later = (l: Link) => l.later_story === story.id
  return (
    <section aria-labelledby={`${id}-h`} className="border-t border-line pt-5">
      <h3 id={`${id}-h`} className="label text-forest">
        What happened next?
      </h3>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink/70">
        Link this story to an earlier one it genuinely follows up. Readers see the link only after it is approved, and only while both stories are published. Nothing is linked automatically.
      </p>

      {error && (
        <p role="alert" className="mt-3 border-l-2 border-earth pl-3 text-[0.875rem] text-earth">
          {error}
        </p>
      )}

      {links && links.length > 0 && (
        <ul className="mt-3 space-y-3">
          {links.map((l) => (
            <li key={l.id} className="border border-line p-3 text-[0.875rem] leading-snug">
              <p>
                <span className={`label mr-2 px-1.5 py-0.5 text-[0.5625rem] ${l.status === 'approved' ? 'bg-mist text-forest' : 'bg-blush text-forest-deep'}`}>{l.status === 'approved' ? 'Approved' : 'Waiting for approval'}</span>
                {later(l) ? 'An update to' : 'Followed up by'}: <span className="font-semibold">{l.other?.headline ?? 'a story that no longer exists'}</span>
                {l.other?.date && <span className="text-ink/70"> ({formatLong(l.other.date)})</span>}
              </p>
              <p className="mt-1 text-ink/75">{l.explanation}</p>
              <p className="mt-1 truncate text-ink/60">Source: {l.source_url}</p>
              <div className="mt-2 flex gap-2">
                {l.status === 'pending' && (
                  <button type="button" className="btn !min-h-11 btn-solid" disabled={busy} onClick={() => void run(() => supabase!.from('story_followups').update({ status: 'approved' }).eq('id', l.id))}>
                    Approve
                  </button>
                )}
                {l.status === 'approved' && (
                  <button type="button" className="btn !min-h-11" disabled={busy} onClick={() => void run(() => supabase!.from('story_followups').update({ status: 'pending' }).eq('id', l.id))}>
                    Withdraw approval
                  </button>
                )}
                <button type="button" className="btn !min-h-11 btn-quiet" disabled={busy} onClick={() => void run(() => supabase!.from('story_followups').delete().eq('id', l.id))}>
                  Remove link
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3">
        <summary className="label flex min-h-11 cursor-pointer items-center text-forest">Link to an earlier story</summary>
        <div className="mt-2 grid gap-3">
          <label className="block">
            <span className="label text-earth">Edition date of the earlier story (before {formatLong(editionDate)})</span>
            <span className="mt-1.5 flex gap-2">
              <input type="date" className="field" value={date} max={editionDate} onChange={(e) => setDate(e.target.value)} />
              <button type="button" className="btn" onClick={() => void findStories()} disabled={!date}>
                Show its stories
              </button>
            </span>
          </label>
          {candidates && (
            <fieldset>
              <legend className="label text-earth">Earlier story</legend>
              {candidates.length === 0 && <p className="mt-1 text-[0.875rem] text-ink/70">No stories in that edition.</p>}
              {candidates.map((c) => (
                <label key={c.id} className="mt-1 flex min-h-11 items-start gap-3 text-[0.9375rem]">
                  <input type="radio" name={`${id}-e`} value={c.id} checked={earlier === c.id} onChange={() => setEarlier(c.id)} className="mt-1 size-4 accent-forest" />
                  <span>
                    {c.position ? `${c.position}. ` : ''}
                    {c.headline}
                    {c.role !== 'primary' && <span className="text-ink/60"> ({c.role}: readers only see links between published stories in the five)</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="block">
            <span className="label text-earth">Why this is a follow-up (shown to readers)</span>
            <textarea className="field mt-1.5" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="e.g. A year after the sanctuary was declared, the government extended it to two more atolls." />
          </label>
          <label className="block">
            <span className="label text-earth">Supporting source (https)</span>
            <input type="url" inputMode="url" className="field mt-1.5" value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-solid justify-self-start"
            disabled={busy || !earlier || explanation.trim().length < 20 || !/^https:\/\//i.test(source)}
            onClick={async () => {
              const ok = await run(() => supabase!.from('story_followups').insert({ earlier_story: earlier, later_story: story.id, explanation: explanation.trim(), source_url: source.trim() }))
              if (ok) {
                setExplanation('')
                setSource('')
                setEarlier('')
                setCandidates(null)
                setDate('')
              }
            }}
          >
            Add link (needs approval)
          </button>
        </div>
      </details>
    </section>
  )
}
