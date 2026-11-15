import { normalizeUrl } from './pipeline/dedupe.ts'
import { describe, evaluateStory, selectFive, type Candidate, type Failure, type GateContext, type GateStory } from './pipeline/gates.ts'
import { hostOf, isTrusted, trustedDomains } from './pipeline/sources.ts'
import type { Notify } from './alerts.ts'
import type { ClaimVerifier, Verification } from './pipeline/verify.ts'

export interface StoredStory {
  id: string
  role: 'primary' | 'backup' | 'rejected'
  position: number | null
  headline: string
  summary: string
  category: string
  sourceName: string
  sourceUrl: string
  sourcePublishedAt: string | null
  sourceMaterial: string | null
  aiRationale: string | null
}

export interface StoredEdition {
  id: string
  date: string
  status: 'draft' | 'review' | 'published'
  stories: StoredStory[]
}

export type PublishDecision = 'published' | 'already_published' | 'held'

/** Everything the publisher needs from storage. The real one talks to Supabase; tests use memory. */
export interface PublishStore {
  loadEdition(date: string): Promise<StoredEdition | null>
  /** normalized or raw URLs of articles in editions published in the last 30 days (before `date`). */
  recentSourceUrls(date: string): Promise<string[]>
  /** The restricted, service-role-only database function. Throws if the database refuses. */
  publish(editionId: string, date: string, primary: string[], rejections: { id: string; reason: string }[]): Promise<PublishDecision>
  record(run: PublishRunRecord): Promise<void>
}

export type PublishStatus = 'published' | 'skipped' | 'failed' | 'disabled' | 'dry_run'

export interface PublishRunRecord {
  date: string
  status: PublishStatus
  trigger: string
  reason: string
  details: {
    accepted?: { headline: string; source: string }[]
    rejected?: { headline: string; source: string; reasons: string[] }[]
    warnings?: string[]
    /** Stories the claim check could not confirm, or found conflicting. */
    needsReview?: { headline: string; source: string; verdict: string; issues: string[] }[]
  }
}

export interface SourceCheck {
  ok: boolean
  /** Why not, in plain words. */
  reason?: string
  /** A non-blocking observation. */
  warning?: string
}
export type SourceChecker = (url: string) => Promise<SourceCheck>

export interface AutoPublishOptions {
  store: PublishStore
  /** The edition's day in the publication's timezone (America/Phoenix). */
  date: string
  trigger: 'schedule' | 'retry' | 'check'
  /** AUTO_PUBLISH_ENABLED. A 'check' run never publishes, so it does not need this. */
  enabled: boolean
  /** Verify everything and report, but publish nothing and record nothing. */
  dryRun?: boolean
  now?: Date
  checkSource?: SourceChecker
  /**
   * Reads each summary claim by claim against its source. Without one, or if it fails or cannot confirm a
   * story, nothing is published automatically: the edition is held for an editor.
   */
  verify?: ClaimVerifier
  /** Longest to wait for all claim checks (the scheduled function has about 30 seconds in all). Default 20s. */
  verifyBudgetMs?: number
  extraTrustedDomains?: string
  notify?: Notify
  log?: (line: string) => void
}

export interface AutoPublishOutcome {
  status: PublishStatus
  reason: string
  record: PublishRunRecord
}

/** Fetch the page the way a reader's browser would, and confirm it is a real, reachable article on a trusted site. */
export function makeSourceChecker(domains: string[], fetchImpl: typeof fetch = fetch): SourceChecker {
  return async (url) => {
    try {
      const res = await fetchImpl(url, { redirect: 'follow', headers: { 'User-Agent': 'TheGoodFiveBot/1.0 (link check)', Accept: 'text/html' }, signal: AbortSignal.timeout(9_000) })
      void res.body?.cancel().catch(() => {})
      const finalUrl = res.url || url
      if (res.status === 403 || res.status === 429) return { ok: true, warning: `The site refused an automated re-check (HTTP ${res.status}); relying on the text retrieved earlier.` }
      if (res.status === 404 || res.status === 410) return { ok: false, reason: `The article is gone (HTTP ${res.status}).` }
      if (!res.ok) return { ok: false, reason: `The article could not be reached (HTTP ${res.status}).` }
      if (!isTrusted(finalUrl, domains)) return { ok: false, reason: `The link redirects to ${hostOf(finalUrl) ?? 'an unrecognised site'}, which is not a trusted source.` }
      if (!(res.headers.get('content-type') ?? '').includes('html')) return { ok: false, reason: 'The link does not lead to a web page.' }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'The article could not be reached (network error or timeout).' }
    }
  }
}

const toGate = (s: StoredStory): GateStory => ({
  headline: s.headline, summary: s.summary, category: s.category, sourceName: s.sourceName, sourceUrl: s.sourceUrl,
  sourcePublishedAt: s.sourcePublishedAt, sourceMaterial: s.sourceMaterial, aiRationale: s.aiRationale,
})

/**
 * The unattended publisher. Safe by construction:
 *  - does nothing unless AUTO_PUBLISH_ENABLED (or it is a dry-run check);
 *  - never touches an edition that is published, or that an editor has marked In review;
 *  - re-verifies every story from the stored source text, so a manual edit is checked, not trusted;
 *  - publishes only when exactly five stories pass; otherwise publishes NOTHING and records why;
 *  - hands the final, atomic step to a restricted database function that re-checks the structure.
 */
export async function runAutoPublish(o: AutoPublishOptions): Promise<AutoPublishOutcome> {
  const log = o.log ?? (() => {})
  const now = o.now ?? new Date()
  const record = async (status: PublishStatus, reason: string, details: PublishRunRecord['details'] = {}): Promise<AutoPublishOutcome> => {
    const run: PublishRunRecord = { date: o.date, status, trigger: o.trigger, reason, details }
    if (!o.dryRun && o.trigger !== 'check') {
      try {
        await o.store.record(run)
      } catch (e) {
        log(`Could not record the run: ${e instanceof Error ? e.message : e}`)
      }
    }
    return { status, reason, record: run }
  }
  const alert = async (message: string) => {
    if (o.dryRun || o.trigger === 'check') return
    await o.notify?.(message + (o.trigger === 'schedule' ? ' A retry runs at 8:00 AM Phoenix time.' : ' Needs attention.'))
  }

  if (!o.enabled && !o.dryRun && o.trigger !== 'check') return record('disabled', 'Automatic publishing is switched off (AUTO_PUBLISH_ENABLED is not "true").')

  try {
    const edition = await o.store.loadEdition(o.date)
    if (!edition) {
      await alert(`No draft exists for ${o.date}, so nothing was published. The latest published edition stays on the site.`)
      return record('failed', `No draft was generated for ${o.date}. The latest published edition stays on the site.`)
    }
    if (edition.status === 'published') return record('skipped', `The edition for ${o.date} is already published. Nothing was changed.`)
    if (edition.status === 'review') return record('skipped', `The edition for ${o.date} is marked In review, so an editor is holding it. Nothing was published.`)

    const domains = trustedDomains(o.extraTrustedDomains)
    const recent = new Set((await o.store.recentSourceUrls(o.date)).map(normalizeUrl))
    const ctx: GateContext = { now, recentUrls: recent, trustedDomains: domains }
    const live = o.checkSource ?? makeSourceChecker(domains)

    const ordered = edition.stories
      .filter((s) => s.role !== 'rejected')
      .sort((a, b) => (a.role === b.role ? (a.position ?? 99) - (b.position ?? 99) : a.role === 'primary' ? -1 : 1))

    const warnings: string[] = []
    const candidates: Candidate<StoredStory>[] = await Promise.all(
      ordered.map(async (item) => {
        const result = evaluateStory(toGate(item), ctx)
        const failures: Failure[] = [...result.failures]
        // Only spend a network request on stories that passed everything else.
        if (result.ok) {
          const check = await live(item.sourceUrl)
          if (!check.ok) failures.push({ code: 'source_unreachable', message: check.reason ?? 'The source could not be reached.' })
          if (check.warning) warnings.push(`${item.headline.slice(0, 40)}: ${check.warning}`)
        }
        warnings.push(...result.warnings.map((w) => `${item.headline.slice(0, 40)}: ${w}`))
        return { item, headline: item.headline, sourceUrl: item.sourceUrl, result: { ok: failures.length === 0, failures, warnings: result.warnings, unaligned: result.unaligned } }
      }),
    )

    // Choose five, then have each one's claims read against its source. A story whose claims conflict with
    // its source is turned away and the next candidate steps in; one that cannot be confirmed holds the edition.
    const verdicts = new Map<string, Verification>()
    let selection = selectFive(candidates, 5)
    for (let round = 0; round < 3 && selection.chosen.length === 5; round++) {
      const pending = selection.chosen.filter((s) => !verdicts.has(s.id))
      if (pending.length === 0) break
      const budget = o.verifyBudgetMs ?? 20_000
      const checked = await Promise.race([
        Promise.all(pending.map(async (s) => [s.id, o.verify ? await o.verify({ headline: s.headline, summary: s.summary, material: s.sourceMaterial ?? '' }) : ({ verdict: 'inconclusive', issues: ['No claim verification is configured, so this story cannot be confirmed automatically.'] } as Verification)] as const)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), budget)),
      ])
      for (const s of pending) verdicts.set(s.id, checked ? checked.find(([id]) => id === s.id)![1] : { verdict: 'inconclusive', issues: ['The claim check timed out.'] })
      const conflicting = pending.filter((s) => verdicts.get(s.id)!.verdict === 'contradicted')
      if (conflicting.length === 0) break
      for (const s of conflicting) {
        const c = candidates.find((x) => x.item.id === s.id)!
        c.result = { ...c.result, ok: false, failures: [...c.result.failures, { code: 'claim_contradiction', message: `Claim check: ${verdicts.get(s.id)!.issues.join(' ')}`.slice(0, 600) }] }
      }
      selection = selectFive(candidates, 5)
    }
    const { chosen, rejected } = selection
    const needsReview = chosen.filter((s) => verdicts.get(s.id)?.verdict !== 'verified').map((s) => ({ headline: s.headline, source: s.sourceName, verdict: verdicts.get(s.id)?.verdict ?? 'inconclusive', issues: verdicts.get(s.id)?.issues ?? ['Not checked.'] }))
    const details = {
      accepted: chosen.map((s) => ({ headline: s.headline, source: s.sourceName })),
      rejected: rejected.map((r) => ({ headline: r.item.headline, source: r.item.sourceName, reasons: r.reasons })),
      warnings,
      ...(needsReview.length ? { needsReview } : {}),
    }

    if (chosen.length < 5) {
      const why = `Only ${chosen.length} of 5 stories passed verification, so nothing was published. The latest published edition stays on the site.`
      await alert(`${why} ${rejected.slice(0, 3).map((r) => `"${r.item.headline.slice(0, 40)}": ${r.reasons[0]}`).join(' | ')}`)
      return record('failed', why, details)
    }
    if (needsReview.length) {
      const why = `Held for an editor: the claim check could not confirm ${needsReview.length} of the 5 stories (${needsReview.map((n) => `"${n.headline.slice(0, 40)}"`).join(', ')}), so nothing was published. The latest published edition stays on the site.`
      await alert(why)
      return record('failed', why, details)
    }
    if (o.dryRun || o.trigger === 'check') return record('dry_run', 'All five stories pass. Automatic publishing would go ahead.', details)

    const decision = await o.store.publish(edition.id, o.date, chosen.map((s) => s.id), rejected.map((r) => ({ id: r.item.id, reason: r.reasons.join(' ').slice(0, 900) })))
    if (decision === 'already_published') return record('skipped', 'Another run published this edition first. Nothing was changed.', details)
    if (decision === 'held') return record('skipped', 'An editor took hold of the edition just before publishing. Nothing was published.', details)
    log(`Published ${o.date}`)
    return record('published', `Published five verified stories for ${o.date}${rejected.length ? `; ${rejected.length} candidate${rejected.length === 1 ? '' : 's'} turned away` : ''}.`, details)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log(`Auto-publish failed: ${message}`)
    await alert(`Automatic publishing failed: ${message.slice(0, 300)}.`)
    return record('failed', `Automatic publishing failed: ${message.slice(0, 400)}`)
  }
}

export { describe }
