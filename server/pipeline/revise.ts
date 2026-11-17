import type { AiClient } from './ai.ts'
import { statementsOf, type VerifyInput } from './verify.ts'

/**
 * A second pass for a story the claim check could not confirm. The writing model sometimes adds wording its
 * source never uses ("crucial", "outdated", "successfully"); the strict check rightly refuses it, and one such
 * word used to cost the story its place. At draft time there are minutes to spare, so the flagged parts are
 * rewritten from the source and the WHOLE story is checked again. A revision is never trusted: it is kept only
 * if it passes the same deterministic gates and the same claim check as any other story.
 */
export interface Revision {
  headline: string
  summary: string
}
export type StoryReviser = (input: VerifyInput & { issues: string[] }, signal?: AbortSignal) => Promise<Revision | null>

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary'],
  properties: { headline: { type: 'string' }, summary: { type: 'string' } },
}

const SYSTEM = `You correct a short news summary so that every statement in it is stated by the article it was written from.
A strict fact-checker read the headline and summary against the article and could not find some parts in it. They are listed below.
Rewrite ONLY those parts:
- Remove any word or claim the article does not make: adjectives and judgements (crucial, outdated, successfully, major, historic), causes, comparisons, superlatives and anything inferred or combined.
- Where the article states the fact differently, use the article's own wording and figures.
- Never add a fact, name, number or quotation that is not in the article. Shorter is fine.
- Keep every other sentence exactly as it is, word for word.
- Write in your own words: never copy more than eight words in a row from the article (names and titles excepted).
- The headline stays plain and factual, under 90 characters, in sentence case (capitalise only the first word and proper nouns), and must also be stated by the article.
Use only the article text given; never use outside knowledge.`

/**
 * The flagged clauses in full. The check's issue lines name each clause by id ('Not stated in the source: S1.2 "..."')
 * but shorten its text, so the text is looked up again from the story itself.
 */
export function flaggedParts(input: Pick<VerifyInput, 'headline' | 'summary'>, issues: string[]): string[] {
  const clauses = new Map(statementsOf(input).flatMap((s) => s.clauses.map((c) => [c.id, c.text] as const)))
  const ids = new Set(issues.flatMap((i) => [...i.matchAll(/\b(H|S\d+)\.\d+\b/g)].map((m) => m[0])))
  return [...ids].map((id) => clauses.get(id)).filter((t): t is string => Boolean(t))
}

const words = (t: string) => t.toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9']+/).filter(Boolean)

/** The longest run of consecutive words the two texts share. Summaries are written in our own words, not copied. */
export function longestSharedRun(text: string, source: string): number {
  const a = words(text)
  const b = words(source)
  const at = new Map<string, number[]>()
  b.forEach((w, j) => at.set(w, [...(at.get(w) ?? []), j]))
  let best = 0
  for (let i = 0; i < a.length; i++) {
    for (const j of at.get(a[i]) ?? []) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k > best) best = k
    }
  }
  return best
}

/** The most consecutive source words a rewrite may reuse (or the original's own figure, if that was already higher). */
const MAX_SHARED_RUN = 12

/**
 * A sane revision: both parts present, the summary neither emptied nor grown, the headline a headline, and no more
 * copied from the source than before. Without the last rule the easiest way to pass a strict check is to paste the
 * publisher's sentences, which is their writing, not a summary.
 */
export function acceptableRevision(before: Revision, after: Revision | null | undefined, material = ''): after is Revision {
  if (!after || typeof after.headline !== 'string' || typeof after.summary !== 'string') return false
  const headline = after.headline.trim()
  const summary = after.summary.trim()
  if (!headline || headline.length > 120 || !summary) return false
  if (summary.length < before.summary.length * 0.5 || summary.length > before.summary.length * 1.15) return false
  if (material && longestSharedRun(summary, material) > Math.max(MAX_SHARED_RUN, longestSharedRun(before.summary, material))) return false
  return headline !== before.headline.trim() || summary !== before.summary.trim()
}

export function aiStoryReviser(ai: AiClient): StoryReviser {
  return async (input, signal) => {
    const parts = flaggedParts(input, input.issues)
    if (parts.length === 0) return null
    try {
      const out = await ai.json<Revision>({
        system: SYSTEM,
        user: `NOT FOUND IN THE ARTICLE:\n${parts.map((p) => `- ${p}`).join('\n')}\n\nHEADLINE:\n${input.headline}\n\nSUMMARY:\n${input.summary}\n\nARTICLE TEXT:\n${input.material.slice(0, 14_000)}`,
        name: 'story_revision',
        schema: SCHEMA,
        maxTokens: 1200,
        signal,
      })
      const revised = { headline: String(out?.headline ?? '').trim(), summary: String(out?.summary ?? '').trim() }
      return acceptableRevision(input, revised, input.material) ? revised : null
    } catch {
      return null
    }
  }
}
