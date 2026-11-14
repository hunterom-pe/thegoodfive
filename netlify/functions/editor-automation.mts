import { makeSourceChecker, runAutoPublish } from '../../server/autopublish.ts'
import { trustedDomains } from '../../server/pipeline/sources.ts'
import { admin, authenticateEditor, editionToday, env, supabasePublishStore } from '../../server/store.ts'

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Read-only support for the editor dashboard. Editors only (verified here, server-side).
 *   { action: "status" } : how the automation is configured. Booleans only, never a value.
 *   { action: "check" }  : verify today's draft against every publication rule and report,
 *                          WITHOUT publishing or recording anything.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { message: 'Use POST.' })
  const c = env()
  if (!c.supabaseUrl || !c.serviceKey) return json(503, { message: 'The server is not configured.' })
  const db = admin()
  const auth = await authenticateEditor(db, req.headers.get('authorization'))
  if (!auth.ok) return json(auth.status, { message: auth.message })

  const { action } = (await req.json().catch(() => ({}))) as { action?: string }
  if (action === 'status') {
    return json(200, { autoPublishEnabled: c.autoPublish, alertsConfigured: Boolean(c.alertWebhook), unsplashConfigured: Boolean(c.unsplashKey), timezone: c.timezone, today: editionToday() })
  }
  if (action === 'check') {
    const outcome = await runAutoPublish({
      store: supabasePublishStore(db), date: editionToday(), trigger: 'check', enabled: c.autoPublish, dryRun: true,
      extraTrustedDomains: c.extraTrusted, checkSource: makeSourceChecker(trustedDomains(c.extraTrusted)),
    })
    return json(200, { status: outcome.status, reason: outcome.reason, details: outcome.record.details })
  }
  return json(400, { message: 'Unknown action.' })
}
