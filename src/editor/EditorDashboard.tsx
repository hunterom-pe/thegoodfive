import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDays, formatLong, isISODate, todayISO } from '../lib/dates'
import { useAsync, useTitle } from '../lib/hooks'
import type { EditorEditionSummary } from '../lib/types'
import { IS_DEMO } from '../lib/config'
import { AutomationPanel } from './AutomationPanel'
import { editorRepo } from './editorRepo'
import { StatusBadge } from './StatusBadge'

function Row({ edition }: { edition: EditorEditionSummary }) {
  const complete = edition.primaryCount === 5
  return (
    <li className="border-t border-line first:border-t-0">
      <Link to={`/editor/${edition.id}`} className="flex min-h-16 items-center justify-between gap-4 py-4 hover:bg-mist/60 sm:px-3">
        <span>
          <span className="display block text-[1.25rem] !leading-tight">{formatLong(edition.date)}</span>
          <span className={`mt-1 block text-[0.8125rem] ${complete ? 'text-ink/70' : 'font-semibold text-earth'}`}>
            {edition.primaryCount} of 5 stories · {edition.backupCount} {edition.backupCount === 1 ? 'backup' : 'backups'}
          </span>
        </span>
        <StatusBadge status={edition.status} />
      </Link>
    </li>
  )
}

function GeneratePanel({ onChanged }: { onChanged: () => void }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [busy])

  async function generate() {
    setBusy(true)
    setSeconds(0)
    setResult(null)
    try {
      const outcome = await editorRepo.generate()
      if (outcome.status === 'succeeded' && outcome.editionId) return navigate(`/editor/${outcome.editionId}`)
      setResult({ ok: outcome.status === 'succeeded', text: outcome.message })
      onChanged()
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Generation failed.' })
    }
    setBusy(false)
  }

  return (
    <section className="border border-forest bg-white p-4 sm:p-5">
      <h2 className="label text-forest">AI draft</h2>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-ink/70">
        Searches recent news, screens it for genuinely good stories and writes a draft of five plus three backups from the original reporting. It saves a <strong>draft only</strong>: nothing is public until you approve it. It fills an empty draft for today and never overwrites stories you already have.
      </p>
      <button type="button" className="btn btn-solid mt-4 w-full sm:w-auto" onClick={generate} disabled={busy || IS_DEMO}>
        {busy ? `Working… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Generate Today’s Five'}
      </button>
      {busy && (
        <p role="status" className="mt-3 text-[0.8125rem] text-ink/70">
          Reading the news and writing the draft. This usually takes one to three minutes. You can leave this page open.
        </p>
      )}
      {IS_DEMO && <p className="mt-3 text-[0.8125rem] text-earth">Not available in demo mode. It needs Supabase, the Netlify functions and an OpenAI key.</p>}
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`mt-3 border-l-2 pl-3 text-[0.875rem] ${result.ok ? 'border-forest text-forest' : 'border-earth text-earth'}`}>
          {result.text}
        </p>
      )}
    </section>
  )
}

function NewEditionPanel({ existing }: { existing: string[] }) {
  const navigate = useNavigate()
  // Suggest the first day, from today onward, that has no edition yet.
  let suggestion = todayISO()
  while (existing.includes(suggestion)) suggestion = addDays(suggestion, 1)
  const [date, setDate] = useState(suggestion)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setBusy(true)
    setError('')
    try {
      navigate(`/editor/${await editorRepo.createEdition(date)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The edition could not be created.')
      setBusy(false)
    }
  }

  return (
    <section className="border border-line bg-white p-4 sm:p-5">
      <h2 className="label text-forest">New edition</h2>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-ink/70">Start an empty draft for a day, then add five stories and up to three backups. Nothing is public until you publish.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label text-earth">Edition date</span>
          <input type="date" className="field mt-1.5 block w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" className="btn btn-solid" onClick={create} disabled={busy || !isISODate(date)}>
          {busy ? 'Creating…' : 'Create draft'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 border-l-2 border-earth pl-3 text-[0.875rem] text-earth">
          {error}
        </p>
      )}
    </section>
  )
}

export function EditorDashboard() {
  useTitle('Editor')
  const [state, reload] = useAsync(() => editorRepo.list(), 'editor-list')
  const editions = state.status === 'ready' ? state.data : []
  const open = editions.filter((e) => e.status !== 'published')
  const published = editions.filter((e) => e.status === 'published')

  return (
    <div className="space-y-10">
      <div>
        <h1 className="display text-[2.25rem] sm:text-5xl">Editions</h1>
        <p className="mt-2 max-w-[30rem] text-[0.9375rem] text-ink/70">Nothing reaches readers until you approve it here.</p>
      </div>

      <AutomationPanel />

      {state.status === 'loading' && <p className="label text-earth">Loading editions…</p>}
      {state.status === 'error' && (
        <p role="alert" className="border-l-2 border-earth pl-3 text-earth">
          {state.error}{' '}
          <button type="button" className="link-quiet font-semibold" onClick={reload}>
            Try again
          </button>
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <section>
            <h2 className="label border-b border-forest pb-2 text-forest">Waiting for you ({open.length})</h2>
            {open.length ? (
              <ul>
                {open.map((e) => (
                  <Row key={e.id} edition={e} />
                ))}
              </ul>
            ) : (
              <p className="py-5 text-[0.9375rem] text-ink/70">Nothing to review. The next draft arrives with tomorrow’s discovery run.</p>
            )}
          </section>

          <GeneratePanel onChanged={reload} />
          <NewEditionPanel existing={editions.map((e) => e.date)} />

          <section>
            <h2 className="label border-b border-forest pb-2 text-forest">Published ({published.length})</h2>
            {published.length ? (
              <ul>
                {published.map((e) => (
                  <Row key={e.id} edition={e} />
                ))}
              </ul>
            ) : (
              <p className="py-5 text-[0.9375rem] text-ink/70">No editions have been published yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
