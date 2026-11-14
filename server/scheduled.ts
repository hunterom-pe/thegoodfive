import { makeSourceChecker, runAutoPublish, type AutoPublishOutcome } from './autopublish.ts'
import { webhookNotifier } from './alerts.ts'
import { trustedDomains } from './pipeline/sources.ts'
import { admin, editionToday, env, missingConfig, startRun, supabasePublishStore, triggerBackground } from './store.ts'

/** 4:00 AM (and the 5:00 AM retry): prepare the day's draft. Costs nothing if a draft already exists. */
export async function scheduledDraft(trigger: 'schedule' | 'retry'): Promise<void> {
  const c = env()
  if (missingConfig().length || !c.secret) {
    console.error('draft:', trigger, 'not configured. Missing:', [...missingConfig(), ...(c.secret ? [] : ['GENERATION_SECRET'])].join(', '))
    return
  }
  const db = admin()
  const run = await startRun(db, editionToday(), trigger === 'retry' ? 'schedule' : 'schedule')
  if (!run.ok) return console.log(`draft ${trigger}: skipped. ${run.message}`)
  const started = await triggerBackground(db, run.runId, run.date)
  if (!started.ok) {
    console.error('draft:', started.message)
    await webhookNotifier(c.alertWebhook)(`Draft generation could not be started: ${started.message}`)
  }
}

/** 7:00 AM (and the 8:00 AM retry): publish today's draft, but only if it passes every check. */
export async function scheduledPublish(trigger: 'schedule' | 'retry'): Promise<AutoPublishOutcome | null> {
  const c = env()
  if (!c.supabaseUrl || !c.serviceKey) {
    console.error('publish: not configured. Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.')
    return null
  }
  const db = admin()
  const outcome = await runAutoPublish({
    store: supabasePublishStore(db),
    date: editionToday(),
    trigger,
    enabled: c.autoPublish,
    extraTrustedDomains: c.extraTrusted,
    checkSource: makeSourceChecker(trustedDomains(c.extraTrusted)),
    notify: webhookNotifier(c.alertWebhook),
    log: console.log,
  })
  // Logged without any credentials: only the outcome, the reason and counts.
  console.log(`publish ${trigger}: ${outcome.status}. ${outcome.reason} accepted=${outcome.record.details.accepted?.length ?? 0} rejected=${outcome.record.details.rejected?.length ?? 0}`)
  return outcome
}
