import type { AiClient } from './ai.ts'

/**
 * Claim-by-claim verification, run before anything is published automatically.
 *
 * The deterministic gates (gates.ts, claims.ts) catch common mistakes but cannot read for meaning.
 * So a second reader goes through the summary one claim at a time and must point to the sentence
 * of the source that supports (or contradicts) each one. Its answer is never taken on trust:
 *  - every cited sentence must actually appear in the source text we retrieved;
 *  - it must account for every sentence of the summary;
 *  - anything it cannot support, or any failure of the check itself, means "inconclusive",
 *    and an inconclusive story is never published without a person.
 * This improves on word overlap. It is still an AI reading, and can be wrong.
 */
export type Verdict = 'verified' | 'contradicted' | 'inconclusive'

export interface Verification {
  verdict: Verdict
  /** Plain-English reasons, for the editor. Empty when verified. */
  issues: string[]
  /** True when the check itself could not run (provider down, timeout, not configured), as opposed to running and not confirming. */
  unavailable?: boolean
}

export interface VerifyInput {
  headline: string
  summary: string
  material: string
}

export type ClaimVerifier = (story: VerifyInput) => Promise<Verification>

interface Raw {
  claims: { claim: string; verdict: 'supported' | 'contradicted' | 'not_in_source'; evidence: string }[]
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'verdict', 'evidence'],
        properties: {
          claim: { type: 'string' },
          verdict: { type: 'string', enum: ['supported', 'contradicted', 'not_in_source'] },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const SYSTEM = `You check a short news summary against the article text it was written from. Be strict and literal.
List every factual claim in the headline and summary (names, numbers and their units, dates, places, who did what to whom, causes, comparisons, and any "first/most/only" style claim). For each claim give a verdict:
- "supported": the article text states this, or states something that means exactly the same. Copy the supporting sentence EXACTLY as written in the article into "evidence".
- "contradicted": the article states something that conflicts (a different number or unit, an opposite, a reversed role, a denied fact). Copy the conflicting sentence exactly into "evidence".
- "not_in_source": the article does not say it. Use this for anything inferred, rounded, converted, combined from separate facts, or stated more strongly than the article states it. Leave "evidence" empty.
Do not be generous: paraphrase is fine, new facts are not. Use only the article text given; never use outside knowledge.`

const norm = (t: string) => t.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9]+/g, ' ').trim()
const sentenceCount = (t: string) => Math.max(1, t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 3).length)

/** Interpret the verifier's answer, refusing evidence that is not in the article. Pure, so it is easy to test. */
export function judge(raw: Raw | null | undefined, input: VerifyInput): Verification {
  const claims = raw?.claims ?? []
  if (claims.length === 0) return { verdict: 'inconclusive', issues: ['The claim check returned nothing.'] }
  const haystack = norm(input.material)
  const issues: string[] = []
  let contradicted = false
  for (const c of claims) {
    const evidence = norm(c.evidence ?? '')
    const found = evidence.length >= 20 && haystack.includes(evidence)
    if (c.verdict === 'supported') {
      if (!found) issues.push(`Not confirmed (no matching sentence found in the source): ${c.claim}`)
    } else if (c.verdict === 'contradicted') {
      if (found) {
        contradicted = true
        issues.push(`Conflicts with the source: ${c.claim}`)
      } else issues.push(`Possibly conflicts with the source (could not locate the sentence): ${c.claim}`)
    } else issues.push(`Not stated in the source: ${c.claim}`)
  }
  if (claims.length < sentenceCount(input.summary)) issues.push('The claim check did not cover every sentence of the summary.')
  if (contradicted) return { verdict: 'contradicted', issues }
  return issues.length ? { verdict: 'inconclusive', issues } : { verdict: 'verified', issues: [] }
}

/** A verifier backed by the same AI client the pipeline uses. Any failure is "inconclusive", never "verified". */
export function aiClaimVerifier(ai: AiClient): ClaimVerifier {
  return async (input) => {
    try {
      const raw = await ai.json<Raw>({
        system: SYSTEM,
        user: `HEADLINE: ${input.headline}\nSUMMARY: ${input.summary}\n\nARTICLE TEXT:\n${input.material.slice(0, 14_000)}`,
        name: 'claim_check',
        schema: SCHEMA,
        maxTokens: 1800,
      })
      return judge(raw, input)
    } catch (e) {
      return { verdict: 'inconclusive', unavailable: true, issues: [`The claim check could not run: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'}`] }
    }
  }
}
