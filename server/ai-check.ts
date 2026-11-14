/**
 * Safe Gemini diagnostic. Run:  npm run ai:check
 *
 * Reads GEMINI_API_KEY (or the older OPENAI_API_KEY) and the model from the environment, then tests Google's
 * native Gemini API and its OpenAI-compatible endpoint side by side and says which part fails.
 * The key is sent ONLY to generativelanguage.googleapis.com and is never printed or logged: the report shows
 * its shape (length, prefix class, stray characters) and a short one-way fingerprint, nothing else.
 */
import { aiConfig, fingerprint, GEMINI_NATIVE, isAuthFailure, keyShape } from './pipeline/gemini.ts'

const env = process.env
const cfg = aiConfig(env)
const raw = (env.GEMINI_API_KEY ?? env.OPENAI_API_KEY ?? '').trim()
if (!cfg.key) {
  console.error('No key found. Set GEMINI_API_KEY (or OPENAI_API_KEY) in your environment or .env.local.')
  process.exit(1)
}
const shape = keyShape(env.GEMINI_API_KEY ?? env.OPENAI_API_KEY ?? '')
console.log('CONFIGURATION (values never shown)')
console.log(`  key from ${cfg.keySource} · ${shape.length} characters · prefix ${shape.prefix} · fingerprint ${fingerprint(cfg.key)}`)
console.log(`  ${shape.problems.length ? `stored with: ${shape.problems.join('; ')} (the application cleans this automatically)` : 'stored cleanly (no stray whitespace, quotes or "Bearer")'}`)
console.log(`  provider ${cfg.provider} · model "${cfg.model}" · endpoint host ${new URL(cfg.baseUrl).host}\n`)
if (cfg.provider !== 'gemini') console.log('(This is not a Google endpoint, so only the compatible-endpoint test below applies.)\n')

function classify(status: number, body: string): string {
  let msg = ''
  let code = ''
  try {
    const j = JSON.parse(body) as { error?: { message?: string; status?: string } } | { error?: { message?: string; status?: string } }[]
    const e = (Array.isArray(j) ? j[0] : j).error
    msg = e?.message ?? ''
    code = e?.status ?? ''
  } catch {
    msg = body.slice(0, 120)
  }
  if (status === 200) return 'OK'
  if (isAuthFailure(status, body) && status !== 403 && status !== 401) return `KEY NOT RECOGNISED: "${msg.slice(0, 60)}". Google does not know this exact value: truncated, altered, revoked, or from another project.`
  if (status === 401 || status === 403 || code === 'PERMISSION_DENIED') return `PERMISSION: ${msg.slice(0, 100)}. If the message says the key is invalid, it is not recognised; otherwise the API may be disabled for this project.`
  if (status === 404 || code === 'NOT_FOUND') return `MODEL NOT FOUND OR UNSUPPORTED: ${msg.slice(0, 100)}`
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return 'RATE LIMIT OR QUOTA EXHAUSTED (the key itself is fine)'
  if (status === 503 || code === 'UNAVAILABLE') return 'MODEL OVERLOADED (temporary; the key is fine)'
  if (status === 400) return `BAD REQUEST (not the key): ${msg.slice(0, 120)}`
  return `HTTP ${status} ${code} ${msg.slice(0, 100)}`
}

async function probe(label: string, url: string, init: RequestInit): Promise<number> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
    const body = await res.text()
    console.log(`  ${res.status === 200 ? 'PASS' : 'FAIL'}  ${label}\n        → HTTP ${res.status}: ${classify(res.status, body)}`)
    return res.status
  } catch (e) {
    console.log(`  FAIL  ${label}\n        → network error: ${e instanceof Error ? e.name : 'unknown'}`)
    return 0
  }
}

const json = { 'Content-Type': 'application/json' }
const q = 'Reply with the single word: ok'
const chat = (extra: object = {}) => JSON.stringify({ model: cfg.model, max_completion_tokens: 200, messages: [{ role: 'user', content: q }], ...extra })
const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } }

if (cfg.provider === 'gemini') {
  console.log('A. GOOGLE NATIVE API (x-goog-api-key header)')
  await probe('list models', `${GEMINI_NATIVE}/models?pageSize=1`, { headers: { 'x-goog-api-key': cfg.key } })
  await probe(`generateContent with "${cfg.model}"`, `${GEMINI_NATIVE}/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: 'POST', headers: { ...json, 'x-goog-api-key': cfg.key }, body: JSON.stringify({ contents: [{ parts: [{ text: q }] }] }) })
  console.log()
}
console.log(`${cfg.provider === 'gemini' ? 'B' : 'A'}. OPENAI-COMPATIBLE ENDPOINT (Authorization: Bearer): the one the application uses`)
await probe(`chat completion with "${cfg.model}"`, `${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${cfg.key}` }, body: chat() })
await probe('structured JSON output (json_schema), as the news pipeline requests it', `${cfg.baseUrl}/chat/completions`, {
  method: 'POST', headers: { ...json, Authorization: `Bearer ${cfg.key}` },
  body: chat({ messages: [{ role: 'user', content: 'Return {"ok": true}' }], response_format: { type: 'json_schema', json_schema: { name: 'check', strict: true, schema } } }),
})
console.log('\nIf A passes and B fails, only the compatibility layer is the problem. If both fail with "KEY NOT RECOGNISED", the key itself is the problem.')
console.log('To check the key stored on Netlify, open /editor: the Automation panel shows its length and fingerprint. They should match the line above.')
void raw
