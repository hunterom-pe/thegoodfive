import type { AiClient } from './ai.ts'

/**
 * Claim-by-claim verification, run before anything is published automatically.
 *
 * The deterministic gates (gates.ts, claims.ts) catch common mistakes but cannot read for meaning, so a second
 * reader checks the summary against the source. What it must answer is fixed HERE, not by the model:
 *  - the headline and each summary sentence are split into clauses (every separately checkable assertion:
 *    "... and created jobs" is its own clause), and each clause gets a stable id (H.1, S1.1, S1.2, ...);
 *  - the reader must judge every clause id exactly once, as a whole, citing the source sentence it relies on;
 *  - a missing, repeated or unknown id makes the answer incomplete (never "verified"): neither the number of
 *    answers nor overlapping vocabulary stands in for coverage;
 *  - every cited sentence must actually appear in the source text we retrieved;
 *  - anything it cannot support, or any failure of the check itself, means "inconclusive".
 * What still depends on the AI: whether a clause it calls "supported" really is supported by the sentence it
 * cites (including the clause's negations and qualifiers). These rules guarantee nothing is skipped and every
 * citation exists; they cannot read meaning, and the reader can still be wrong.
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

/** `signal` abandons the check (the result is then "unavailable"). */
export type ClaimVerifier = (story: VerifyInput, signal?: AbortSignal) => Promise<Verification>

/** One clause, with the stable id the verifier must answer for. */
export interface Clause {
  id: string
  text: string
}
/** A headline or sentence and the clauses it is made of. */
export interface Statement {
  id: string
  text: string
  clauses: Clause[]
}

interface RawAnswer {
  id: string
  verdict: 'supported' | 'contradicted' | 'not_in_source'
  evidence: string
}
interface Raw {
  clauses: RawAnswer[]
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clauses'],
  properties: {
    clauses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'evidence'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['supported', 'contradicted', 'not_in_source'] },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const SYSTEM = `You check a short news summary against the article text it was written from. Be strict and literal.
You are given numbered STATEMENTS ([H] is the headline, [S1], [S2]... the summary's sentences), each split into numbered CLAUSES ([H.1], [S1.1], [S1.2]...).
Judge EVERY clause id exactly once, in order. Never skip, merge, repeat or invent an id. Read each clause in the context of its statement, and judge the WHOLE clause: every name, number and unit, date, place, who did what to whom, cause, comparison, negation (not, no, never) and qualifier (only, about, nearly, more than, may, could, first).
- "supported": the article states all of this clause, or something that means exactly the same. Copy the supporting sentence EXACTLY as written in the article into "evidence".
- "contradicted": the article states something that conflicts with the clause (a different number or unit, an opposite, a reversed role, a denied fact, a missing or added qualifier). Copy the conflicting sentence exactly into "evidence".
- "not_in_source": the article does not state all of it. Use this for anything inferred, rounded, converted, combined from separate facts, or stated more strongly than the article states it. Leave "evidence" empty.
Do not be generous: paraphrase is fine, new facts are not. Use only the article text given; never use outside knowledge.`

const norm = (t: string) => t.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Words that only hold a sentence together. Everything else in a statement carries meaning and must be accounted
 * for, including the short words that change a claim: negations (not, no, never), qualifiers (only, about, nearly,
 * more, than, first), modals (may, could, will) and numbers. Those are deliberately NOT in this list.
 */
const GRAMMAR = new Set(
  'a an the of to in on at by for from with into onto upon as is are was were be been being am has have had having do does did doing it its this that these those there their them they he she his her him we our us you your i me my and or but if then so also just which who whom whose what when where while whereas because although though since until unless whether very'.split(' '),
)
/** A crude stem, so "counted"/"counts"/"count" and "jobs"/"job" meet; numbers lose their thousands separators. */
const stem = (w: string) => {
  let x = w
  if (x.length > 5) x = x.replace(/(ing|ed|es)$/, '')
  else if (x.length > 4) x = x.replace(/ed$/, '')
  if (x.length > 3) x = x.replace(/s$/, '')
  return x.slice(0, 7)
}
/** The meaning-bearing words of a text, stemmed. "didn't" counts as "not". */
export function meaningWords(t: string): string[] {
  return t
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/n't\b/g, ' not')
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9.%$]+/g, ' ')
    .split(' ')
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w && (/\d/.test(w) || w === 'no' || (w.length > 1 && !GRAMMAR.has(w))))
    .map(stem)
}

/**
 * The clauses of a statement: every separately checkable assertion. Splits at commas (not inside numbers),
 * semicolons, dashes and the words that join one assertion to another ("and", "but", "while", "which",
 * "because", "including"...). Over-splitting is harmless: it only means each piece must be accounted for.
 */
export function clausesOf(statement: string): string[] {
  return statement
    .replace(/(\d),(\d)/g, '$1\u0000$2')
    .split(/\s*[,;:]\s+|\s+[—–-]\s+|\s+(?=(?:and|but|or|while|whereas|which|who|because|although|though|so|yet|including|plus|after|before|whilst|thereby|as well as)\b)/i)
    .map((c) => c.replace(/\u0000/g, ',').trim())
    .filter((c) => meaningWords(c).length > 0)
}

/** Split a story into statements (headline, then each sentence) and each statement into clauses with stable ids. */
export function statementsOf(input: Pick<VerifyInput, 'headline' | 'summary'>): Statement[] {
  const texts: [string, string][] = []
  if (input.headline.trim()) texts.push(['H', input.headline.trim()])
  input.summary
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'‘(])/)
    .map((x) => x.trim())
    .filter((x) => x.length > 3)
    .forEach((sentence, i) => texts.push([`S${i + 1}`, sentence]))
  return texts.map(([id, text]) => ({ id, text, clauses: clausesOf(text).map((c, k) => ({ id: `${id}.${k + 1}`, text: c })) }))
}

/**
 * Interpret the verifier's answer. Pure, so it is easy to test. "verified" needs ALL of: every clause id
 * answered exactly once, no unknown ids, and every clause supported by a sentence that really is in the source.
 */
export function judge(raw: Raw | null | undefined, input: VerifyInput): Verification {
  const expected = statementsOf(input).flatMap((s) => s.clauses)
  const answers = Array.isArray(raw?.clauses) ? raw!.clauses.filter((a) => a && typeof a === 'object') : []
  if (expected.length === 0) return { verdict: 'inconclusive', issues: ['There was nothing to check.'] }
  if (answers.length === 0) return { verdict: 'inconclusive', issues: ['The claim check returned nothing.'] }
  const haystack = norm(input.material)
  const issues: string[] = []
  let contradicted = false

  const known = new Set(expected.map((e) => e.id))
  const seen = new Map<string, number>()
  for (const a of answers) seen.set(String(a.id), (seen.get(String(a.id)) ?? 0) + 1)
  for (const [id, n] of seen) {
    if (!known.has(id)) issues.push(`The claim check answered for a clause that does not exist (${id}).`)
    else if (n > 1) issues.push(`The claim check answered clause ${id} ${n} times.`)
  }
  for (const e of expected) {
    const n = seen.get(e.id) ?? 0
    if (n === 0) {
      issues.push(`Not checked: ${e.id} ("${e.text.slice(0, 80)}").`)
      continue
    }
    if (n > 1) continue
    const a = answers.find((x) => x.id === e.id)!
    const evidence = norm(a.evidence ?? '')
    const found = evidence.length >= 20 && haystack.includes(evidence)
    if (a.verdict === 'supported') {
      if (!found) issues.push(`Not confirmed (no matching sentence found in the source): ${e.id} "${e.text.slice(0, 80)}"`)
    } else if (a.verdict === 'contradicted') {
      if (found) {
        contradicted = true
        issues.push(`Conflicts with the source: ${e.id} "${e.text.slice(0, 80)}"`)
      } else issues.push(`Possibly conflicts with the source (could not locate the sentence): ${e.id} "${e.text.slice(0, 80)}"`)
    } else issues.push(`Not stated in the source: ${e.id} "${e.text.slice(0, 80)}"`)
  }
  // A located conflict is decisive (and rejecting is the safe direction). Anything short of full, valid coverage is inconclusive.
  if (contradicted) return { verdict: 'contradicted', issues }
  return issues.length ? { verdict: 'inconclusive', issues } : { verdict: 'verified', issues: [] }
}

/** A verifier backed by the same AI client the pipeline uses. Any failure is "inconclusive", never "verified". */
export function aiClaimVerifier(ai: AiClient): ClaimVerifier {
  return async (input, signal) => {
    try {
      const listed = statementsOf(input).map((s) => `[${s.id}] ${s.text}\n${s.clauses.map((c) => `  [${c.id}] ${c.text}`).join('\n')}`).join('\n')
      const raw = await ai.json<Raw>({
        system: SYSTEM,
        user: `STATEMENTS AND CLAUSES:\n${listed}\n\nARTICLE TEXT:\n${input.material.slice(0, 14_000)}`,
        name: 'claim_check',
        schema: SCHEMA,
        maxTokens: 2400,
        signal,
      })
      return judge(raw, input)
    } catch (e) {
      return { verdict: 'inconclusive', unavailable: true, issues: [`The claim check could not run: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'}`] }
    }
  }
}
