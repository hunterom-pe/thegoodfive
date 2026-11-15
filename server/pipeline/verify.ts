import type { AiClient } from './ai.ts'

/**
 * Claim-by-claim verification, run before anything is published automatically.
 *
 * The deterministic gates (gates.ts, claims.ts) catch common mistakes but cannot read for meaning.
 * So a second reader goes through the summary one claim at a time and must point to the sentence
 * of the source that supports (or contradicts) each one. Its answer is never taken on trust:
 *  - the headline and every sentence of the summary are numbered here (H, S1, S2...), and the reader must
 *    answer for each number exactly once, listing the claims it makes in that statement's own words;
 *  - a missing, repeated or unknown number, or claims that leave part of a statement unaccounted for,
 *    make the answer incomplete: the count of answers never stands in for coverage;
 *  - every cited sentence must actually appear in the source text we retrieved;
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

/** One thing the summary asserts, with a stable id the verifier must answer for. */
export interface Statement {
  id: string
  text: string
}

interface RawClaim {
  claim: string
  verdict: 'supported' | 'contradicted' | 'not_in_source'
  evidence: string
}
interface Raw {
  statements: { id: string; claims: RawClaim[] }[]
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['statements'],
  properties: {
    statements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'claims'],
        properties: {
          id: { type: 'string' },
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
      },
    },
  },
}

const SYSTEM = `You check a short news summary against the article text it was written from. Be strict and literal.
You are given numbered STATEMENTS: [H] is the headline, [S1], [S2]... are the summary's sentences or parts of sentences.
Return every statement id exactly once, in order. For each, list EVERY factual claim it makes (names, numbers and their units, dates, places, who did what to whom, causes, comparisons, and any "first/most/only" style claim), each written using the statement's own words, so that together the claims cover the whole statement. For each claim give a verdict:
- "supported": the article text states this, or states something that means exactly the same. Copy the supporting sentence EXACTLY as written in the article into "evidence".
- "contradicted": the article states something that conflicts (a different number or unit, an opposite, a reversed role, a denied fact). Copy the conflicting sentence exactly into "evidence".
- "not_in_source": the article does not say it. Use this for anything inferred, rounded, converted, combined from separate facts, or stated more strongly than the article states it. Leave "evidence" empty.
Do not be generous: paraphrase is fine, new facts are not. Use only the article text given; never use outside knowledge. Never skip, merge, repeat or invent a statement id.`

const norm = (t: string) => t.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9]+/g, ' ').trim()
const STOP = new Set('that this with from have been were will into over after their about more than other which where while there these those they them what when also very such some each every both your just only said says'.split(' '))
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
/** The words that carry a statement's meaning: numbers, and words of four letters or more. */
const meaning = (t: string): Set<string> => new Set(norm(t).split(' ').filter((w) => /\d/.test(w) || (w.length >= 4 && !STOP.has(w))).map(singular))

/** Split a story into the statements that must each be checked: the headline, then each sentence (and each part of a ";"-joined sentence). */
export function statementsOf(input: Pick<VerifyInput, 'headline' | 'summary'>): Statement[] {
  const out: Statement[] = []
  if (input.headline.trim()) out.push({ id: 'H', text: input.headline.trim() })
  const sentences = input.summary.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'‘(])/).map((x) => x.trim()).filter((x) => x.length > 3)
  sentences.forEach((sentence, i) => {
    const parts = sentence.split(/;\s+/).map((x) => x.trim()).filter((x) => x.length > 3)
    if (parts.length > 1) parts.forEach((part, j) => out.push({ id: `S${i + 1}${String.fromCharCode(97 + j)}`, text: part }))
    else out.push({ id: `S${i + 1}`, text: sentence })
  })
  return out
}

/** Share of a statement's meaning words that its claims mention. */
function coverage(statement: string, claims: RawClaim[]): { ratio: number; missing: string[] } {
  const need = meaning(statement)
  const have = new Set(claims.flatMap((c) => [...meaning(c.claim)]))
  const missing = [...need].filter((w) => !have.has(w))
  return { ratio: need.size === 0 ? 1 : (need.size - missing.length) / need.size, missing }
}

/** How much of the statement's wording the listed claims must repeat. Paraphrase is allowed; skipping a fact is not. */
export const MIN_COVERAGE = 0.7

/**
 * Interpret the verifier's answer. Pure, so it is easy to test. "verified" needs ALL of:
 * every statement id answered exactly once and no unknown ids; each with at least one claim; the claims
 * together covering the statement's wording; and every claim supported by a sentence that really is in the source.
 */
export function judge(raw: Raw | null | undefined, input: VerifyInput): Verification {
  const expected = statementsOf(input)
  const answers = Array.isArray(raw?.statements) ? raw!.statements : []
  if (answers.length === 0) return { verdict: 'inconclusive', issues: ['The claim check returned nothing.'] }
  const haystack = norm(input.material)
  const issues: string[] = []
  let contradicted = false

  const known = new Map(expected.map((e) => [e.id, e]))
  const seen = new Map<string, number>()
  for (const a of answers) seen.set(String(a?.id), (seen.get(String(a?.id)) ?? 0) + 1)
  for (const [id, n] of seen) {
    if (!known.has(id)) issues.push(`The claim check answered for a statement that does not exist (${id}).`)
    else if (n > 1) issues.push(`The claim check answered statement ${id} ${n} times.`)
  }
  for (const e of expected) if (!seen.has(e.id)) issues.push(`Not checked: ${e.id === 'H' ? 'the headline' : `statement ${e.id}`} ("${e.text.slice(0, 80)}").`)

  for (const e of expected) {
    const answer = answers.find((a) => a?.id === e.id)
    if (!answer || (seen.get(e.id) ?? 0) > 1) continue
    const claims = Array.isArray(answer.claims) ? answer.claims.filter((c) => c && typeof c.claim === 'string') : []
    if (claims.length === 0) {
      issues.push(`No claims listed for ${e.id} ("${e.text.slice(0, 80)}").`)
      continue
    }
    const cov = coverage(e.text, claims)
    if (cov.ratio < MIN_COVERAGE) issues.push(`The claims listed for ${e.id} leave part of it unchecked (${cov.missing.slice(0, 6).join(', ')}).`)
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
  }
  // A located conflict is decisive (and rejecting is the safe direction). Anything else short of full, valid coverage is inconclusive.
  if (contradicted) return { verdict: 'contradicted', issues }
  return issues.length ? { verdict: 'inconclusive', issues } : { verdict: 'verified', issues: [] }
}

/** A verifier backed by the same AI client the pipeline uses. Any failure is "inconclusive", never "verified". */
export function aiClaimVerifier(ai: AiClient): ClaimVerifier {
  return async (input) => {
    try {
      const listed = statementsOf(input).map((s) => `[${s.id}] ${s.text}`).join('\n')
      const raw = await ai.json<Raw>({
        system: SYSTEM,
        user: `STATEMENTS:\n${listed}\n\nARTICLE TEXT:\n${input.material.slice(0, 14_000)}`,
        name: 'claim_check',
        schema: SCHEMA,
        maxTokens: 2400,
      })
      return judge(raw, input)
    } catch (e) {
      return { verdict: 'inconclusive', unavailable: true, issues: [`The claim check could not run: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'}`] }
    }
  }
}
