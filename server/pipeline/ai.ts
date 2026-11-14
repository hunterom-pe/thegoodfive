/** A minimal structured-output client for the OpenAI API. No SDK: one fetch call. */
export interface JsonRequest {
  system: string
  user: string
  /** Schema name (letters, digits, underscores). */
  name: string
  /** A strict JSON Schema: every property required, additionalProperties false. */
  schema: Record<string, unknown>
  maxTokens: number
}

export interface AiClient {
  json<T>(request: JsonRequest): Promise<T>
}

import { explainAuthFailure, isAuthFailure, normaliseKey } from './gemini.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  /** Waits between retries of a busy provider (default 5s, 20s, 60s). */
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
          signal: AbortSignal.timeout((options.timeoutSeconds ?? 240) * 1000),
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
        if ((res.status === 429 || res.status >= 500) && retries < 3) {
          const wait = (options.retryDelaysMs ?? [5_000, 20_000, 60_000])[retries++] ?? 60_000
          options.log?.(`AI provider busy (HTTP ${res.status}); retry ${retries}/3 in ${wait / 1000}s`)
          await sleep(wait)
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
