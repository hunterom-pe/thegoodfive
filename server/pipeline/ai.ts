/** A minimal structured-output client for the OpenAI API. No SDK: one fetch call. */
export interface JsonRequest {
  system: string
  user: string
  /** Schema name (letters, digits, underscores). */
  name: string
  /** A strict JSON Schema: every property required, additionalProperties false. */
  schema: Record<string, unknown>
  maxTokens: number
  /** Abandon the request (and any wait before a retry) when this fires. */
  signal?: AbortSignal
}

export interface AiClient {
  json<T>(request: JsonRequest): Promise<T>
}

import { explainAuthFailure, isAuthFailure, normaliseKey } from './gemini.ts'

/** Wait, unless the signal fires first (then reject at once, so no caller is kept waiting). */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason ?? new Error('Aborted'))), { once: true })
  })

/** Models sometimes wrap JSON in a code fence when strict schemas aren't enforced. */
const parseJson = <T>(text: string): T => JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''))

/**
 * Works with OpenAI and with any provider that offers an OpenAI-compatible
 * chat endpoint (Google Gemini, Groq, OpenRouter, a local Ollama...). If a
 * provider rejects strict JSON schemas, it falls back once to plain JSON mode
 * with the schema spelled out in the prompt. Our own checks validate the
 * result either way.
 */
export interface AiOptions {
  /** "low" or "none" makes thinking models (Gemini, o-series) answer much faster. Only sent when set. */
  reasoningEffort?: string
  timeoutSeconds?: number
  /** Waits between retries of a busy provider (default 5s, 20s, 60s). The number of entries is the number of retries. */
  retryDelaysMs?: number[]
  /** Which environment variable the key came from, for error messages. */
  keySource?: 'GEMINI_API_KEY' | 'OPENAI_API_KEY' | 'none'
  /** Told about retries and fallbacks, so slow runs are explainable. */
  log?: (line: string) => void
}

export function openAiClient(rawKey: string, model: string, baseUrl = 'https://api.openai.com/v1', options: AiOptions = {}): AiClient {
  const apiKey = normaliseKey(rawKey) // survives quotes, a pasted "Bearer " and stray whitespace
  const provider = baseUrl.includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai-compatible'
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  return {
    async json<T>(request: JsonRequest): Promise<T> {
      let strict = true
      let retries = 0
      for (let attempt = 0; attempt < 6; attempt++) {
        const system = strict ? request.system : `${request.system}\n\nReply with a single JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(request.schema)}`
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: request.user },
            ],
            response_format: strict ? { type: 'json_schema', json_schema: { name: request.name, strict: true, schema: request.schema } } : { type: 'json_object' },
            max_completion_tokens: request.maxTokens,
            ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
          }),
          signal: request.signal ? AbortSignal.any([AbortSignal.timeout((options.timeoutSeconds ?? 240) * 1000), request.signal]) : AbortSignal.timeout((options.timeoutSeconds ?? 240) * 1000),
        })
        const detail = res.ok ? '' : await res.clone().text()
        // A rejected KEY is not a schema problem: report it at once instead of retrying in a different request format.
        if (!res.ok && isAuthFailure(res.status, detail)) throw new Error(explainAuthFailure(res.status, apiKey, provider, options.keySource))
        if (res.status === 400 && strict) {
          options.log?.('AI provider rejected strict JSON schema; retrying in plain JSON mode')
          strict = false // this provider doesn't take strict schemas: try plain JSON mode
          continue
        }
        if (res.status === 429) {
          if (detail.includes('insufficient_quota')) throw new Error('The AI account has no credits. Add billing credit, or point OPENAI_BASE_URL at a free provider.')
        }
        // Rate limits and overloaded servers are usually brief: wait and retry a few times (5s, 20s, 60s).
        // Nothing else is worth repeating, or paying for.
        // Exactly as many retries as there are delays: a short list never falls back to a long wait.
        const delays = options.retryDelaysMs ?? [5_000, 20_000, 60_000]
        if ((res.status === 429 || res.status >= 500) && retries < delays.length) {
          const wait = delays[retries++]
          options.log?.(`AI provider busy (HTTP ${res.status}); retry ${retries}/${delays.length} in ${wait / 1000}s`)
          void res.body?.cancel().catch(() => {})
          await sleep(wait, request.signal)
          continue
        }
        if (!res.ok) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 240)}`)
        const body = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[] }
        const choice = body.choices?.[0]
        if (choice?.message?.refusal) throw new Error('The model declined the request.')
        if (choice?.finish_reason === 'length') throw new Error('The model’s answer was cut off. Try again, or raise the token limit.')
        if (!choice?.message?.content) throw new Error('The AI provider returned an empty answer.')
        return parseJson<T>(choice.message.content)
      }
      throw new Error('The AI provider could not be reached.')
    },
  }
}
