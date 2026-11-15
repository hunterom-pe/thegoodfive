import { makeSourceChecker, runAutoPublish, type AutoPublishOutcome } from './autopublish.ts'
import { webhookNotifier } from './alerts.ts'
import { trustedDomains } from './pipeline/sources.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, claimVerifier, editionToday, env, missingConfig, startRun, supabasePublishStore, triggerBackground } from './store.ts'

/** 4:00 AM (and the 5:00 AM retry): prepare the day's draft. Costs nothing if a draft already exists. */
export async function scheduledDraft(trigger: 'schedule' | 'retry', deps: { db?: SupabaseClient } = {}): Promise<void> {
  const c = env()
  if ((!deps.db && missingConfig().length) || !c.secret) {
    console.error('draft:', trigger, 'not configured. Missing:', [...missingConfig(), ...(c.secret ? [] : ['GENERATION_SECRET'])].join(', '))
    return
  }
  try {
    const db = deps.db ?? admin()
    const run = await startRun(db, editionToday(), 'schedule')
    if (!run.ok) {
      // 409 and 429 are expected answers (already drafted, already running, budget spent). A 500 means a required
      // check could not be completed: that is a failure to report, not a quiet skip.
      if (run.status !== 500) return console.log(`draft ${trigger}: skipped. ${run.message}`)
      console.error(`draft ${trigger}: ${run.message}`)
      await webhookNotifier(c.alertWebhook)(`Draft generation could not start: ${run.message.slice(0, 300)}${trigger === 'schedule' ? ' A retry runs at 5:00 AM Phoenix time.' : ' Needs attention.'}`)
      return
    }
    const started = await triggerBackground(db, run.runId, run.date)
    if (!started.ok) {
      console.error('draft:', started.message)
      await webhookNotifier(c.alertWebhook)(`Draft generation could not be started: ${started.message}`)
    }
  } catch (e) {
    // A database outage must be reported, not thrown into the platform. The 5:00 AM retry tries again.
    const message = e instanceof Error ? e.message : String(e)
    console.error('draft: failed:', message)
    await webhookNotifier(c.alertWebhook)(`Draft generation could not start: ${message.slice(0, 300)}${trigger === 'schedule' ? ' A retry runs at 5:00 AM Phoenix time.' : ' Needs attention.'}`)
  }
}

/** 7:00 AM (and the 8:00 AM retry): publish today's draft, but only if it passes every check. */
export async function scheduledPublish(trigger: 'schedule' | 'retry', deps: { db?: SupabaseClient } = {}): Promise<AutoPublishOutcome | null> {
  const c = env()
  if (!deps.db && (!c.supabaseUrl || !c.serviceKey)) {
    console.error('publish: not configured. Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.')
    return null
  }
  const db = deps.db ?? admin()
  const outcome = await runAutoPublish({
    store: supabasePublishStore(db),
    date: editionToday(),
    trigger,
    enabled: c.autoPublish,
    extraTrustedDomains: c.extraTrusted,
    checkSource: makeSourceChecker(trustedDomains(c.extraTrusted)),
    verify: claimVerifier(),
    notify: webhookNotifier(c.alertWebhook),
    log: console.log,
  })
  // Logged without any credentials: only the outcome, the reason and counts.
  console.log(`publish ${trigger}: ${outcome.status}. ${outcome.reason} accepted=${outcome.record.details.accepted?.length ?? 0} rejected=${outcome.record.details.rejected?.length ?? 0}`)
  return outcome
}
