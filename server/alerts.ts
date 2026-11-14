/**
 * Optional failure notifications through any incoming-webhook URL (Slack, Discord,
 * ntfy.sh, Make, Zapier...): no extra paid service is needed. Set ALERT_WEBHOOK_URL.
 * The body carries both `text` (Slack) and `content` (Discord). Messages are written
 * by our own code from run outcomes and never contain keys or credentials.
 */
export type Notify = (message: string) => Promise<void>

export function webhookNotifier(url: string | undefined, fetchImpl: typeof fetch = fetch): Notify {
  return async (message) => {
    if (!url || !/^https:\/\//i.test(url)) return
    const text = `The Good Five: ${message}`.slice(0, 1800)
    try {
      await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(8_000) })
    } catch {
      /* an alert that cannot be delivered must never break the job it reports on */
    }
  }
}
