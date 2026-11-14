import { describe, expect, it, vi } from 'vitest'
import { openAiClient } from './ai'
import { aiConfig, checkGeminiKey, explainAuthFailure, fingerprint, isAuthFailure, keyShape, normaliseKey } from './gemini'

const KEY = 'AQ.Ab8RN6ExampleKeyForTestsOnly_0123456789abcdefgh'

describe('key handling', () => {
  it('repairs the ways a pasted key gets mangled', () => {
    for (const bad of [` ${KEY}\n`, `"${KEY}"`, `'${KEY}'`, `Bearer ${KEY}`, `bearer  "${KEY}" `]) expect(normaliseKey(bad), bad).toBe(KEY)
  })
  it('describes a key without revealing it', () => {
    const s = keyShape(`"${KEY}" `)
    expect(s).toMatchObject({ length: KEY.length, prefix: 'AQ.' })
    expect(s.problems.join(' ')).toMatch(/quotes|whitespace/)
    expect(JSON.stringify(s)).not.toContain(KEY)
    expect(keyShape('AIzaSyExample').prefix).toBe('AIza')
    expect(keyShape('').prefix).toBe('empty')
  })
  it('fingerprints identically however the key was pasted, and differently for another key, without containing it', () => {
    expect(fingerprint(KEY)).toBe(fingerprint(`"${KEY}"\n`))
    expect(fingerprint(KEY)).not.toBe(fingerprint(`${KEY.slice(0, -1)}X`))
    expect(fingerprint(KEY)).toHaveLength(6)
    expect(KEY).not.toContain(fingerprint(KEY))
    expect(fingerprint('')).toBe('')
  })
})

describe('configuration', () => {
  it('prefers GEMINI_* and defaults the endpoint and model for Gemini', () => {
    expect(aiConfig({ GEMINI_API_KEY: KEY } as NodeJS.ProcessEnv)).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash-lite', keySource: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' })
    expect(aiConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-x', OPENAI_API_KEY: 'sk-old', OPENAI_MODEL: 'gpt-old' } as NodeJS.ProcessEnv)).toMatchObject({ key: KEY, model: 'gemini-x', keySource: 'GEMINI_API_KEY' })
  })
  it('keeps the original OPENAI_* names working, for Gemini and for OpenAI', () => {
    expect(aiConfig({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/', OPENAI_MODEL: 'gemini-m' } as NodeJS.ProcessEnv)).toMatchObject({ provider: 'gemini', key: KEY, model: 'gemini-m', keySource: 'OPENAI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' })
    expect(aiConfig({ OPENAI_API_KEY: 'sk-x' } as NodeJS.ProcessEnv)).toMatchObject({ provider: 'openai-compatible', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' })
    expect(aiConfig({} as NodeJS.ProcessEnv)).toMatchObject({ keySource: 'none', key: '' })
  })
})

describe('precedence when GEMINI_API_KEY is set', () => {
  const google = 'https://generativelanguage.googleapis.com/v1beta/openai'
  it('always uses Google’s endpoint and GEMINI_MODEL, ignoring OPENAI_BASE_URL and OPENAI_MODEL', () => {
    const c = aiConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-x', OPENAI_BASE_URL: 'https://api.openai.com/v1', OPENAI_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: 'sk-old' } as NodeJS.ProcessEnv)
    expect(c).toMatchObject({ provider: 'gemini', baseUrl: google, model: 'gemini-x', key: KEY, keySource: 'GEMINI_API_KEY' })
  })
  it('uses the default Gemini model when GEMINI_MODEL is empty, even if OPENAI_MODEL is set', () => {
    expect(aiConfig({ GEMINI_API_KEY: KEY, OPENAI_MODEL: 'gpt-4.1-mini', OPENAI_BASE_URL: 'http://localhost:11434/v1' } as NodeJS.ProcessEnv)).toMatchObject({ provider: 'gemini', baseUrl: google, model: 'gemini-3.5-flash-lite' })
  })
  it('still honours legacy OPENAI_BASE_URL / OPENAI_MODEL when there is no Gemini key', () => {
    expect(aiConfig({ OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://localhost:11434/v1/', OPENAI_MODEL: 'llama3.1' } as NodeJS.ProcessEnv)).toMatchObject({ provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keySource: 'OPENAI_API_KEY' })
    expect(aiConfig({ GEMINI_API_KEY: '   ', OPENAI_API_KEY: 'sk-x' } as NodeJS.ProcessEnv)).toMatchObject({ provider: 'openai-compatible', keySource: 'OPENAI_API_KEY' })
  })
})

describe('recognising a rejected key', () => {
  it('knows Google’s key-rejection messages, and does not confuse them with other 400s', () => {
    for (const body of ['[{"error":{"code":400,"message":"Invalid Auth key.","status":"INVALID_ARGUMENT"}}]', 'Please pass a valid API key', 'API key not valid. Please pass a valid API key.', 'Missing or invalid Authorization header.']) expect(isAuthFailure(400, body), body).toBe(true)
    expect(isAuthFailure(401, '')).toBe(true)
    expect(isAuthFailure(400, '{"error":{"message":"Unsupported response_format json_schema","status":"INVALID_ARGUMENT"}}')).toBe(false)
    expect(isAuthFailure(429, 'quota')).toBe(false)
  })
  it('explains the failure with the key’s shape and never its value', () => {
    const msg = explainAuthFailure(400, KEY, 'gemini', 'OPENAI_API_KEY')
    expect(msg).toMatch(/OPENAI_API_KEY is 50 characters, starts "AQ\."/)
    expect(msg).toContain(fingerprint(KEY))
    expect(msg).toMatch(/AI Studio/)
    expect(msg).not.toContain(KEY)
  })
})

describe('the AI client and a rejected key', () => {
  const real = globalThis.fetch
  const withFetch = (impl: typeof fetch) => { globalThis.fetch = impl }
  const done = () => { globalThis.fetch = real }
  const request = { system: 's', user: 'u', name: 'n', schema: { type: 'object' }, maxTokens: 10 }
  const reject = () => new Response('[{"error":{"code":400,"message":"Invalid Auth key.","status":"INVALID_ARGUMENT"}}]', { status: 400 })

  it('fails once with a clear message: no pointless retry in another request format, and no key in the error', async () => {
    const calls = vi.fn(async () => reject())
    withFetch(calls as unknown as typeof fetch)
    const err = await openAiClient(KEY, 'gemini-x', 'https://generativelanguage.googleapis.com/v1beta/openai', { keySource: 'OPENAI_API_KEY' }).json(request).catch((e: Error) => e)
    done()
    expect(calls).toHaveBeenCalledTimes(1)
    expect((err as Error).message).toMatch(/rejected the API key \(HTTP 400\)/)
    expect((err as Error).message).toContain(fingerprint(KEY))
    expect((err as Error).message).not.toContain(KEY)
  })

  it('still falls back to plain JSON mode when a provider only dislikes the strict schema', async () => {
    const calls = vi.fn(async (_u: string, init: RequestInit) => (JSON.parse(String(init.body)).response_format.type === 'json_schema' ? new Response('{"error":{"message":"response_format json_schema is not supported"}}', { status: 400 }) : new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }))))
    withFetch(calls as unknown as typeof fetch)
    const out = await openAiClient(KEY, 'm', 'https://api.example.com/v1').json<{ ok: boolean }>(request)
    done()
    expect(out).toEqual({ ok: true })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('sends the cleaned key, however it was stored', async () => {
    const seen: string[] = []
    withFetch((async (_u: string, init: RequestInit) => { seen.push(String((init.headers as Record<string, string>).Authorization)); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] })) }) as unknown as typeof fetch)
    await openAiClient(`  "${KEY}"\n`, 'm', 'https://api.example.com/v1').json(request)
    await openAiClient(`Bearer ${KEY}`, 'm', 'https://api.example.com/v1').json(request)
    done()
    expect(seen).toEqual([`Bearer ${KEY}`, `Bearer ${KEY}`])
  })
})

describe('checking a key with Google’s native API', () => {
  it('uses the x-goog-api-key header, only against Google, and reads the answer', async () => {
    const calls: { url: string; header: string | undefined }[] = []
    const fake = (status: number, body = '{}') => (async (url: string, init: RequestInit) => { calls.push({ url, header: (init.headers as Record<string, string>)['x-goog-api-key'] }); return new Response(body, { status }) }) as unknown as typeof fetch
    expect(await checkGeminiKey(KEY, fake(200))).toMatchObject({ ok: true })
    expect(await checkGeminiKey(KEY, fake(400, '[{"error":{"message":"Invalid Auth key."}}]'))).toMatchObject({ ok: false })
    expect(await checkGeminiKey(KEY, fake(429))).toMatchObject({ ok: true })
    expect(await checkGeminiKey(KEY, fake(503))).toMatchObject({ ok: null })
    expect(await checkGeminiKey('', fake(200))).toMatchObject({ ok: false })
    expect(calls.every((c) => c.url.startsWith('https://generativelanguage.googleapis.com/') && c.header === KEY)).toBe(true)
  })
})
