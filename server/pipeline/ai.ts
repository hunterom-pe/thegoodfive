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
export function openAiClient(apiKey: string, model: string, baseUrl = 'https://api.openai.com/v1'): AiClient {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  return {
    async json<T>(request: JsonRequest): Promise<T> {
      let strict = true
      let retried = false
      for (let attempt = 0; attempt < 4; attempt++) {
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
          }),
          signal: AbortSignal.timeout(150_000),
        })
        if (res.status === 400 && strict) {
          strict = false // this provider doesn't take strict schemas: try plain JSON mode
          continue
        }
        if (res.status === 429) {
          const detail = await res.clone().text()
          if (detail.includes('insufficient_quota')) throw new Error('The AI account has no credits. Add billing credit, or point OPENAI_BASE_URL at a free provider.')
        }
        // One retry on rate limits and server errors; nothing else is worth repeating (and spending on).
        if ((res.status === 429 || res.status >= 500) && !retried) {
          retried = true
          await sleep(res.status === 429 ? 15_000 : 5_000)
          continue
        }
        if (res.status === 401 || res.status === 403) throw new Error('The AI provider rejected the API key. Check OPENAI_API_KEY.')
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
