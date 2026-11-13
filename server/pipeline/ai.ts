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

export function openAiClient(apiKey: string, model: string): AiClient {
  return {
    async json<T>(request: JsonRequest): Promise<T> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            response_format: { type: 'json_schema', json_schema: { name: request.name, strict: true, schema: request.schema } },
            max_completion_tokens: request.maxTokens,
          }),
          signal: AbortSignal.timeout(150_000),
        })
        if (res.status === 429) {
          const detail = await res.clone().text()
          if (detail.includes('insufficient_quota')) throw new Error('The OpenAI account has no credits. Add billing credit at platform.openai.com/settings/organization/billing, then try again.')
        }
        // One retry on rate limits and server errors; nothing else is worth repeating (and spending on).
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await sleep(5_000)
          continue
        }
        if (res.status === 401 || res.status === 403) throw new Error('OpenAI rejected the API key. Check OPENAI_API_KEY.')
        if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 240)}`)
        const body = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[] }
        const choice = body.choices?.[0]
        if (choice?.message?.refusal) throw new Error('The model declined the request.')
        if (choice?.finish_reason === 'length') throw new Error('The model’s answer was cut off. Try again, or raise the token limit.')
        if (!choice?.message?.content) throw new Error('OpenAI returned an empty answer.')
        return JSON.parse(choice.message.content) as T
      }
      throw new Error('OpenAI could not be reached.')
    },
  }
}
