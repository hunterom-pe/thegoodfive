import { createHash } from 'node:crypto'

/**
 * AI provider configuration and key diagnostics (Google Gemini, or any OpenAI-compatible provider).
 *
 * Nothing here ever returns, logs or prints a key. Diagnostics describe a key's SHAPE (length, prefix
 * class, stray characters) and a short one-way fingerprint, so you can tell whether the key stored on the
 * server is the same one that works on your machine without exposing it.
 */
export const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_COMPAT = `${GEMINI_NATIVE}/openai`
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

/** Clean up the ways a key gets mangled when it is pasted into a settings page. */
export function normaliseKey(raw: string): string {
  let k = raw.trim()
  if (/^bearer\s+/i.test(k)) k = k.replace(/^bearer\s+/i, '')
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1)
  return k.trim()
}

export interface KeyShape {
  length: number
  prefix: 'AQ.' | 'AIza' | 'sk-' | 'other' | 'empty'
  /** What was wrong with the stored value (all of which normaliseKey repairs). */
  problems: string[]
}

export function keyShape(raw: string): KeyShape {
  const k = normaliseKey(raw)
  const problems: string[] = []
  if (raw !== raw.trim()) problems.push('leading or trailing whitespace')
  if (/^["']|["']$/.test(raw.trim())) problems.push('wrapped in quotes')
  if (/^bearer\s/i.test(raw.trim())) problems.push('starts with "Bearer "')
  if (/\s/.test(k)) problems.push('contains a space or line break inside the key')
  return { length: k.length, prefix: !k ? 'empty' : k.startsWith('AQ.') ? 'AQ.' : k.startsWith('AIza') ? 'AIza' : k.startsWith('sk-') ? 'sk-' : 'other', problems }
}

/** Six characters of a one-way hash: enough to compare two copies of a key, useless for recovering it. */
export const fingerprint = (raw: string): string => (normaliseKey(raw) ? createHash('sha256').update(normaliseKey(raw)).digest('hex').slice(0, 6) : '')

export interface AiConfig {
  provider: 'gemini' | 'openai-compatible'
  key: string
  model: string
  /** OpenAI-compatible base URL the pipeline calls. */
  baseUrl: string
  keySource: 'GEMINI_API_KEY' | 'OPENAI_API_KEY' | 'none'
}

/**
 * One place that decides which key, model and endpoint to use.
 *   Preferred:  GEMINI_API_KEY + GEMINI_MODEL
 *   Still works: OPENAI_API_KEY + OPENAI_MODEL + OPENAI_BASE_URL (the original names)
 * GEMINI_* wins when both are set.
 */
export function aiConfig(e: NodeJS.ProcessEnv): AiConfig {
  const gemini = (e.GEMINI_API_KEY ?? '').trim()
  const legacy = (e.OPENAI_API_KEY ?? '').trim()
  // A Gemini key ALWAYS means Google's official endpoint and GEMINI_MODEL: a leftover OPENAI_BASE_URL / OPENAI_MODEL must never redirect it.
  // The legacy OPENAI_* settings apply only when there is no GEMINI_API_KEY.
  const baseUrl = gemini ? GEMINI_COMPAT : (e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  return {
    provider: baseUrl.includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai-compatible',
    key: normaliseKey(gemini || legacy),
    model: (gemini ? e.GEMINI_MODEL || DEFAULT_GEMINI_MODEL : e.OPENAI_MODEL || e.GEMINI_MODEL || 'gpt-4.1-mini').trim(),
    baseUrl,
    keySource: gemini ? 'GEMINI_API_KEY' : legacy ? 'OPENAI_API_KEY' : 'none',
  }
}

/** Does a rejected request mean "your key is not accepted" (as opposed to a bad request body)? */
export function isAuthFailure(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true
  return status === 400 && /invalid auth key|valid api key|api key not valid|missing or invalid authorization|incorrect api key|invalid_api_key|api_key_invalid/i.test(body)
}

/** A plain-English explanation of a rejected key. Describes the key's shape, never its value. */
export function explainAuthFailure(status: number, key: string, provider: AiConfig['provider'], source: AiConfig['keySource'] = 'OPENAI_API_KEY'): string {
  const s = keyShape(key)
  const where = source === 'none' ? 'the AI API key' : source
  const shape = `${where} is ${s.length} characters, starts "${s.prefix}", fingerprint ${fingerprint(key) || 'none'}`
  const advice =
    provider === 'gemini'
      ? 'Google answers "Invalid Auth key" when it does not recognise the exact value: the key stored on the server is truncated, altered, revoked, or from a different project than the one you tested. Copy the key again from Google AI Studio (Get API key), paste it with no quotes, and run `npm run ai:check` to compare the fingerprint with the one shown in the editor’s Automation panel.'
      : 'The provider does not recognise this key. Copy it again from the provider’s dashboard and check it is not revoked.'
  return `The AI provider rejected the API key (HTTP ${status}). ${shape}. ${advice}`
}

export interface KeyCheck {
  /** null when the provider cannot be checked this way (not Google). */
  ok: boolean | null
  status: number
  cause: string
}

/** Ask Google's native API, with the x-goog-api-key header, whether it accepts this key. Free; sends the key only to Google. */
export async function checkGeminiKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  if (!key) return { ok: false, status: 0, cause: 'No key is set.' }
  try {
    const res = await fetchImpl(`${GEMINI_NATIVE}/models?pageSize=1`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) })
    if (res.ok) return { ok: true, status: res.status, cause: 'Google accepts the key.' }
    const body = await res.text()
    if (isAuthFailure(res.status, body) || res.status === 400) return { ok: false, status: res.status, cause: 'Google does not recognise this key.' }
    if (res.status === 429) return { ok: true, status: res.status, cause: 'The key is accepted but the quota is exhausted.' }
    return { ok: null, status: res.status, cause: `Google answered HTTP ${res.status}.` }
  } catch {
    return { ok: null, status: 0, cause: 'Could not reach Google to check the key.' }
  }
}
