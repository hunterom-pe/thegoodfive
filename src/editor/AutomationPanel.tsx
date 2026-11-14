import { useState, type ReactNode } from 'react'
import { formatLong, todayISO } from '../lib/dates'
import { useAsync } from '../lib/hooks'
import { nextOccurrence, untilLabel } from '../lib/schedule'
import { editorRepo, type AutomationSnapshot, type PublishCheckReport } from './editorRepo'

const when = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const clock = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d)

const STATUS_TEXT: Record<string, string> = {
  published: 'Published',
  skipped: 'Skipped',
  failed: 'Failed',
  disabled: 'Auto-publishing is off',
  dry_run: 'Checked',
  succeeded: 'Draft created',
  running: 'Running now',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[11rem_1fr]">
      <dt className="label text-earth">{label}</dt>
      <dd className="text-[0.9375rem] leading-snug">{children}</dd>
    </div>
  )
}

const Pill = ({ tone, children }: { tone: 'good' | 'quiet' | 'bad'; children: ReactNode }) => (
  <span className={`label inline-flex items-center gap-2 border px-2 py-1.5 ${tone === 'good' ? 'border-forest bg-forest text-chalk' : tone === 'bad' ? 'border-earth bg-blush/50 text-forest-deep' : 'border-line text-ink/70'}`}>
    <span className={`size-1.5 ${tone === 'good' ? 'bg-blush' : tone === 'bad' ? 'bg-earth' : 'bg-sage'}`} aria-hidden="true" />
    {children}
  </span>
)

/** What the robot did today, what it will do next, and why anything was turned away. */
export function AutomationPanel() {
  const today = todayISO()
  const [state, reload] = useAsync(() => editorRepo.automation(today), 'automation')
  const [check, setCheck] = useState<{ state: 'idle' | 'running' | 'done' | 'error'; report?: PublishCheckReport; error?: string }>({ state: 'idle' })

  async function runCheck() {
    setCheck({ state: 'running' })
    try {
      setCheck({ state: 'done', report: await editorRepo.checkPublish() })
    } catch (e) {
      setCheck({ state: 'error', error: e instanceof Error ? e.message : 'The check failed.' })
    }
  }

  if (state.status === 'loading') return <p className="label text-earth">Loading automation status…</p>
  if (state.status === 'error')
    return (
      <p role="alert" className="border-l-2 border-earth pl-3 text-earth">
        Could not load the automation status: {state.error}{' '}
        <button type="button" className="link-quiet font-semibold" onClick={reload}>
          Try again
        </button>
      </p>
    )

  const s: AutomationSnapshot = state.data
  const now = new Date()
  const nextPublish = nextOccurrence(now, 7)
  const nextDraft = nextOccurrence(now, 4)
  const rejected = s.publication?.rejected.length ? s.publication.rejected.map((r) => ({ headline: r.headline, reason: r.reasons.join(' ') })) : (s.today?.rejected ?? [])
  const todayPublished = s.today?.status === 'published'
  const failed = s.publication?.status === 'failed' || s.generation?.status === 'failed'
  const enabled = s.config?.autoPublishEnabled

  return (
    <section aria-labelledby="automation-h" className="border border-forest bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="automation-h" className="label text-forest">
          Automation
        </h2>
        {s.config === null ? <Pill tone="quiet">Status unavailable</Pill> : enabled ? <Pill tone="good">Auto-publishing on</Pill> : <Pill tone="quiet">Auto-publishing off</Pill>}
      </div>

      {failed && !todayPublished && (
        <p role="alert" className="mt-3 border-l-2 border-earth bg-blush/30 py-2 pl-3 pr-2 text-[0.9375rem] text-forest-deep">
          <strong>Needs attention.</strong> Today’s edition did not publish itself. Readers still see {s.lastPublished ? `the edition from ${formatLong(s.lastPublished.date)}` : 'the latest published edition'}. Details below.
        </p>
      )}

      <dl className="mt-3">
        <Row label="Automatic publishing">
          {s.config === null ? (
            'Unknown here (demo mode, or the server could not be reached).'
          ) : enabled ? (
            'On. A verified edition publishes itself each morning.'
          ) : (
            <>Off. Drafts wait for you to publish them. To switch it on, set <code className="bg-mist px-1">AUTO_PUBLISH_ENABLED=true</code> in Netlify and redeploy.</>
          )}
        </Row>
        <Row label="Last published">
          {s.lastPublished ? (
            <>
              {formatLong(s.lastPublished.date)} <span className="text-ink/70">· {s.lastPublished.automatic ? 'published automatically' : 'published by hand'} · {when(s.lastPublished.publishedAt)}</span>
            </>
          ) : (
            'Nothing published yet.'
          )}
        </Row>
        <Row label="Next scheduled">
          <span className="block">Draft: {clock(nextDraft)} Phoenix <span className="text-ink/70">({untilLabel(now, nextDraft)})</span></span>
          <span className="block">Publish: {clock(nextPublish)} Phoenix <span className="text-ink/70">({untilLabel(now, nextPublish)})</span></span>
        </Row>
        <Row label="Today’s draft">
          {s.generation ? (
            <>
              <strong>{STATUS_TEXT[s.generation.status] ?? s.generation.status}</strong> <span className="text-ink/70">· {when(s.generation.startedAt)}</span>
              {s.generation.error && <span className="mt-1 block text-earth">{s.generation.error}</span>}
            </>
          ) : (
            <span className="text-ink/70">The draft hasn’t run yet today.</span>
          )}
          {s.today && (
            <span className="mt-1 block text-ink/70">
              {s.today.primary} of 5 stories · {s.today.backup} {s.today.backup === 1 ? 'backup' : 'backups'} · edition is {s.today.status}
            </span>
          )}
        </Row>
        <Row label="Today’s publication">
          {s.publication ? (
            <>
              <strong>{STATUS_TEXT[s.publication.status] ?? s.publication.status}</strong> <span className="text-ink/70">· {when(s.publication.startedAt)}</span>
              {s.publication.reason && <span className={`mt-1 block ${s.publication.status === 'failed' ? 'text-earth' : 'text-ink/75'}`}>{s.publication.reason}</span>}
            </>
          ) : (
            <span className="text-ink/70">{todayPublished ? 'Published by hand today.' : 'The publish step hasn’t run yet today.'}</span>
          )}
        </Row>
        <Row label="Stories">
          {s.publication ? `${s.publication.accepted} accepted · ${rejected.length} turned away` : s.today ? `${s.today.primary} in the lineup · ${s.today.rejected.length} turned away` : '—'}
        </Row>
        <Row label="AI provider">
          {!s.config?.ai ? (
            'Unknown here.'
          ) : s.config.ai.accepted === false ? (
            <>
              <strong className="text-earth">The server’s AI key is rejected.</strong> Google does not recognise the key stored in <code className="bg-mist px-1">{s.config.ai.keySource}</code> ({s.config.ai.keyLength} characters, starts “{s.config.ai.keyPrefix}”, fingerprint <code className="bg-mist px-1">{s.config.ai.fingerprint}</code>). Re-copy the key from Google AI Studio into Netlify, then redeploy. <span className="text-ink/70">Run <code className="bg-mist px-1">npm run ai:check</code> on your computer: its fingerprint should match.</span>
            </>
          ) : (
            <>
              {s.config.ai.provider === 'gemini' ? 'Gemini' : 'AI provider'} · model {s.config.ai.model} ·{' '}
              {s.config.ai.accepted ? 'key accepted' : s.config.ai.cause}
              <span className="block text-ink/70">Key from {s.config.ai.keySource}: {s.config.ai.keyLength} characters, fingerprint {s.config.ai.fingerprint}</span>
            </>
          )}
        </Row>
        <Row label="Failure alerts">{s.config === null ? 'Unknown here.' : s.config.alertsConfigured ? 'On: a message is sent to your webhook when something fails.' : 'Off. Add ALERT_WEBHOOK_URL to be told when something fails.'}</Row>
      </dl>

      {rejected.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="label text-earth">Turned away, and why</h3>
          <ul className="mt-2 space-y-3">
            {rejected.map((r) => (
              <li key={r.headline} className="text-[0.875rem] leading-snug">
                <span className="font-semibold">{r.headline}</span>
                <span className="mt-0.5 block text-ink/75">{r.reason || 'No reason recorded.'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <button type="button" className="btn" onClick={runCheck} disabled={check.state === 'running'}>
          {check.state === 'running' ? 'Checking…' : 'Check today’s edition now'}
        </button>
        <p className="mt-2 text-[0.8125rem] text-ink/70">Runs every publication check on today’s draft and tells you the result. It publishes nothing.</p>
        {check.state === 'error' && (
          <p role="alert" className="mt-3 border-l-2 border-earth pl-3 text-[0.875rem] text-earth">
            {check.error}
          </p>
        )}
        {check.state === 'done' && check.report && (
          <div role="status" className={`mt-3 border-l-2 pl-3 text-[0.875rem] ${check.report.status === 'dry_run' ? 'border-forest' : 'border-earth'}`}>
            <p className="font-semibold">{check.report.status === 'dry_run' ? 'Ready: every check passes.' : 'Not ready.'}</p>
            <p className="text-ink/80">{check.report.reason}</p>
            {check.report.details.rejected?.map((r) => (
              <p key={r.headline} className="mt-1 text-ink/75">
                <strong>{r.headline}</strong>: {r.reasons.join(' ')}
              </p>
            ))}
            {check.report.details.warnings?.map((w) => (
              <p key={w} className="mt-1 text-ink/70">Note: {w}</p>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="link-quiet mt-3 min-h-11 text-[0.8125rem] font-semibold text-forest" onClick={reload}>
        Refresh status
      </button>
    </section>
  )
}
