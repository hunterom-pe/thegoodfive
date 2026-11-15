/**
 * Optional failure notifications through any incoming-webhook URL (Slack, Discord,
 * ntfy.sh, Make, Zapier...): no extra paid service is needed. Set ALERT_WEBHOOK_URL.
 * The body carries both `text` (Slack) and `content` (Discord). Messages are written
 * by our own code from run outcomes and never contain keys or credentials.
 *
 * Delivery is checked: a webhook that answers with an error status, times out or cannot be
 * reached is reported back as `{ ok: false, error }` (never thrown), so the caller can record
 * that nobody was told while still finishing the job it was reporting on.
 */
export interface NotifyResult {
  /** False when no alert was delivered. */
  ok: boolean
  /** Why, for the run record. Never contains the webhook address. */
  error?: string
  /** True when no webhook is configured (nothing was attempted). */
  skipped?: boolean
}

export type Notify = (message: string) => Promise<NotifyResult | void>

export function webhookNotifier(url: string | undefined, fetchImpl: typeof fetch = fetch): Notify {
  return async (message) => {
    if (!url) return { ok: true, skipped: true }
    if (!/^https:\/\//i.test(url)) {
      console.error('alert: ALERT_WEBHOOK_URL is not an https address; no alert was sent.')
      return { ok: false, error: 'The alert webhook address is not an https URL.' }
    }
    const text = `The Good Five: ${message}`.slice(0, 1800)
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(8_000) })
      void res.body?.cancel().catch(() => {})
      if (!res.ok) {
        console.error(`alert: the webhook answered HTTP ${res.status}; the alert was not delivered.`)
        return { ok: false, error: `The alert webhook answered HTTP ${res.status}.` }
      }
      return { ok: true }
    } catch (e) {
      const reason = e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'could not be reached'
      console.error(`alert: the webhook ${reason}; the alert was not delivered.`)
      return { ok: false, error: `The alert webhook ${reason}.` }
    }
  }
}

/**
 * Wraps a notifier so that every failed delivery is remembered. The list is stored with the run's record,
 * so a failure nobody was alerted about is still visible in the dashboard. Never throws.
 */
export function trackedNotifier(notify: Notify | undefined): { notify: (message: string) => Promise<void>; failures: string[] } {
  const failures: string[] = []
  return {
    failures,
    notify: async (message) => {
      if (!notify) return
      try {
        const r = await notify(message)
        if (r && !r.ok) failures.push(r.error ?? 'The alert was not delivered.')
      } catch (e) {
        failures.push(`The alert could not be sent: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown error'}`)
      }
    },
  }
}
