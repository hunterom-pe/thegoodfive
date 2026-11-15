import { normalizeUrl, titleSimilarity } from './dedupe.ts'
import { hostOf, isTrusted, TRUSTED_DOMAINS } from './sources.ts'
import { ungroundedNumbers, ungroundedQuotes, wordCount } from './curate.ts'
import { checkClaims } from './claims.ts'

/**
 * Deterministic publication gates.
 *
 * Nothing here asks an AI whether a story is accurate. Each check compares the
 * words and details on the page with the source text retrieved from the publisher, or tests
 * a plain structural rule. These checks catch common errors (invented figures, wrong units,
 * negated or reversed claims, conclusions the source never draws). They do NOT verify every
 * claim: summary sentences they cannot match to the source are listed in `unaligned`, and
 * the publisher requires a separate claim verification (verify.ts) before publishing. A story that cannot be supported is REJECTED, never
 * "scored": there is no confidence number to argue with. The same function runs
 * when a draft is generated and again just before publishing, so a manual edit
 * is re-checked rather than trusted.
 */
export type FailureCode =
  | 'no_headline' | 'no_summary' | 'no_source_name' | 'url_invalid' | 'source_not_trusted' | 'source_unreachable'
  | 'undated' | 'stale' | 'future_dated' | 'insufficient_evidence' | 'numbers_unsupported' | 'quote_unsupported'
  | 'entities_unsupported' | 'weakly_grounded' | 'headline_hype' | 'headline_form' | 'summary_length'
  | 'claim_contradiction' | 'claim_unconfirmed' | 'conclusion_unsupported' | 'preliminary_unqualified' | 'not_positive' | 'sensitive_content' | 'recent_duplicate' | 'near_duplicate' | 'no_positive_assessment'

export interface Failure {
  code: FailureCode
  message: string
}

export interface GateStory {
  id?: string
  headline: string
  summary: string
  category: string
  sourceName: string
  sourceUrl: string
  sourcePublishedAt: string | null
  /** The publisher's text this summary was written from. */
  sourceMaterial: string | null
  /** Why the screening AI thought this was good news. Required, but never sufficient. */
  aiRationale: string | null
}

export interface GateContext {
  now: Date
  /** normalizeUrl() forms of articles used in recent editions. */
  recentUrls: Set<string>
  trustedDomains?: string[]
  /** Oldest acceptable source, in hours. Default 120 (five days). */
  maxAgeHours?: number
}

export interface GateResult {
  ok: boolean
  failures: Failure[]
  /** Things worth a person's glance that do not block publication. */
  warnings: string[]
  /** Summary sentences the deterministic checks could not tie to any sentence of the source. */
  unaligned?: string[]
}

// ── Tunable thresholds, in one place ────────────────────────────────────
export const LIMITS = {
  minMaterialChars: 450,
  minSummaryWords: 50,
  maxSummaryWords: 115,
  minHeadlineChars: 25,
  maxHeadlineChars: 110,
  /** Share of the summary's substantive words that must appear in the source. */
  minGrounding: 0.6,
  /** Unsupported capitalised names allowed in a summary before it is rejected. */
  maxUnsupportedEntities: 1,
  /** Headline similarity at which two stories are the same event. */
  nearDuplicate: 0.5,
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const NOT_ENTITIES = new Set(
  `the this that these those there their they then than with from into over under after before about across during while when where which what who whom whose why how and but for nor yet not has have had was were been being are its it's our your his her him she he we you i a an as at by in of on or to up is be do did does can may will would could should might must also still new more most some many each every both either neither one two three four five six seven eight nine ten first second third monday tuesday wednesday thursday friday saturday sunday`.split(
    /\s+/,
  ),
)

const wordsOf = (text: string) => text.toLowerCase().replace(/[’']s\b/g, '').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean)

/** Capitalised words that are not the first word of a sentence: the names in a text. */
export function namesIn(text: string): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const tokens = sentence.split(/\s+/)
    tokens.forEach((raw, i) => {
      const t = raw.replace(/^[("“'‘]+|[)”"'’.,;:!?]+$/g, '').replace(/[’']s$/, '')
      if (i === 0 || !/^[A-Z][A-Za-z'’-]{2,}$/.test(t)) return
      const lower = t.toLowerCase()
      if (!NOT_ENTITIES.has(lower) && !MONTHS.includes(lower)) out.push(t)
    })
  }
  return out
}

const stem = (w: string) => w.slice(0, 6)

/**
 * Headlines written in Title Case capitalise every verb and adjective, which hides which words are
 * really names. Convert them to sentence case, keeping a capital only where the story itself
 * capitalises the word mid-sentence (a name), or for acronyms and numbers. Headlines already in
 * sentence case are returned unchanged.
 */
export function sentenceCaseHeadline(headline: string, knownNames: Iterable<string>): string {
  const words = headline.split(/\s+/).filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 4)
  const capitalised = words.filter((w) => /^[A-Z]/.test(w)).length
  if (words.length < 4 || capitalised / words.length < 0.6) return headline
  const known = new Set([...knownNames].map((n) => n.toLowerCase()))
  return headline
    .split(/(\s+)/)
    .map((tok, i) => {
      if (!tok.trim()) return tok
      const core = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9'’-]+$/g, '').replace(/['’]s$/, '')
      if (i === 0) return tok.charAt(0).toUpperCase() + tok.slice(1)
      if (/^[A-Z0-9]{2,}\.?$/.test(core) || /\d/.test(core) || known.has(core.toLowerCase())) return tok
      return tok.toLowerCase()
    })
    .join('')
}

/** Share of the summary's substantive words (5+ letters) that also appear, by stem, in the source. */
export function groundingRatio(summary: string, material: string): number {
  const have = new Set(wordsOf(material).map(stem))
  const mine = wordsOf(summary).filter((w) => w.length >= 5)
  return mine.length === 0 ? 0 : mine.filter((w) => have.has(stem(w))).length / mine.length
}

const PRELIMINARY_IN_SOURCE =
  /\b(preliminary|early[- ]stage|early (findings|results|data|trial)|pilot (study|trial|programme|program)|small (study|trial|sample)|proof[- ]of[- ]concept|in mice|in rats|animal (study|model)|preclinical|phase (1|i|one)\b|not yet (been )?(peer[- ]reviewed|approved)|preprint|experimental|compassionate use|more research (is )?needed|further (research|studies|trials)|yet to be (confirmed|replicated)|hope to)\b/i
const HEDGE_IN_SUMMARY =
  /\b(preliminary|early|pilot|experimental|small|initial|promising|so far|first step|if confirmed|still (needs?|requires?)|more research|further (research|study|studies|trials)|not yet|in mice|in animals|researchers (hope|say|suggest|believe)|suggests?|may|might|could|hope[sd]?)\b/i
const HYPE = /\b(cures?|cured|miracles?|breakthrough|revolution(ary|ize[sd]?|ise[sd]?)|game[- ]chang(er|ing)|shocking|stunning|incredible|unbelievable|amazing|you won'?t believe|forever|solves?|proves?|proven)\b/i
const NEGATIVE =
  /\b(kill(s|ed|ing)?|dead|deaths?|dies|died|dying|murder(ed|s)?|massacre|shooting|terror(ist|ism)?|bomb(ing|ed|s)?|war crimes?|abuse[sd]?|assault(ed)?|suicide|crash(es|ed)?|disaster|tragedy|scandal|victims?|plunge[sd]?|collapse[sd]?|layoffs?|lawsuit|sues?)\b/gi
const SENSITIVE =
  /\b(porn(ography)?|sexual(ly)? (abuse|assault)|rape[sd]?|suicid(e|al)|self[- ]harm|genocide|torture[sd]?|incest|child abuse|overdose[sd]?|beheading|fuck\w*|shit\w*|bitch\w*|cunt)\b/i

export function evaluateStory(s: GateStory, ctx: GateContext): GateResult {
  const failures: Failure[] = []
  const warnings: string[] = []
  let unaligned: string[] = []
  const fail = (code: FailureCode, message: string) => failures.push({ code, message })

  const headline = s.headline.trim()
  const summary = s.summary.trim()
  const material = (s.sourceMaterial ?? '').trim()

  // ── Completeness and the source itself ──
  if (!headline) fail('no_headline', 'Missing headline.')
  if (!summary) fail('no_summary', 'Missing summary.')
  if (!s.sourceName.trim()) fail('no_source_name', 'Missing publisher name.')
  const host = hostOf(s.sourceUrl)
  if (!/^https:\/\//i.test(s.sourceUrl) || !host) fail('url_invalid', 'The source link is missing or is not a valid https address.')
  else if (!isTrusted(s.sourceUrl, ctx.trustedDomains ?? TRUSTED_DOMAINS)) fail('source_not_trusted', `${host} is not on the trusted-sources list.`)
  if (!s.aiRationale?.trim()) fail('no_positive_assessment', 'The story was never assessed as positive news.')

  // ── Freshness ──
  if (!s.sourcePublishedAt) fail('undated', 'The source has no publication date, so its freshness cannot be confirmed.')
  else {
    const ageHours = (ctx.now.getTime() - Date.parse(s.sourcePublishedAt)) / 3_600_000
    if (Number.isNaN(ageHours)) fail('undated', 'The source date could not be read.')
    else if (ageHours > (ctx.maxAgeHours ?? 120)) fail('stale', `The source is ${Math.round(ageHours / 24)} days old.`)
    else if (ageHours < -1) fail('future_dated', 'The source date is in the future.')
  }

  // ── Repeats ──
  if (host && ctx.recentUrls.has(normalizeUrl(s.sourceUrl))) fail('recent_duplicate', 'This article already ran in a recent edition.')

  // ── Headline form ──
  if (headline) {
    if (headline.length < LIMITS.minHeadlineChars || headline.length > LIMITS.maxHeadlineChars || headline.split(/\s+/).length < 4 || /[!?]\s*$/.test(headline) || /!/.test(headline))
      fail('headline_form', 'The headline must be a specific statement of 25 to 110 characters, not a question or exclamation.')
    if (/\b[A-Z]{6,}\b/.test(headline)) fail('headline_form', 'The headline shouts in capitals.')
    if (HYPE.test(headline)) fail('headline_hype', `The headline uses exaggerated wording ("${headline.match(HYPE)?.[0]}").`)
  }
  if (summary) {
    const words = wordCount(summary)
    if (words < LIMITS.minSummaryWords || words > LIMITS.maxSummaryWords) fail('summary_length', `The summary is ${words} words (expected ${LIMITS.minSummaryWords} to ${LIMITS.maxSummaryWords}).`)
  }

  // ── Positive, and fit for a general audience ──
  const text = `${headline} ${summary}`
  if (NEGATIVE.test(headline)) fail('not_positive', `The headline reads as negative news ("${headline.match(NEGATIVE)?.[0]}").`)
  NEGATIVE.lastIndex = 0
  const negatives = summary.match(NEGATIVE)?.length ?? 0
  NEGATIVE.lastIndex = 0
  if (negatives >= 3) fail('not_positive', 'The summary is dominated by negative terms.')
  if (SENSITIVE.test(text)) fail('sensitive_content', 'Contains language that may not suit a general audience.')

  // ── Evidence: everything below compares the words with the source text ──
  if (material.length < LIMITS.minMaterialChars) {
    fail('insufficient_evidence', `Only ${material.length} characters of source text were retrieved (need ${LIMITS.minMaterialChars}).`)
  } else if (summary) {
    const numbers = ungroundedNumbers(text, material)
    if (numbers.length) fail('numbers_unsupported', `Figures not found in the source: ${numbers.join(', ')}.`)

    const quotes = ungroundedQuotes(text, material)
    if (quotes.length) fail('quote_unsupported', `Quotation not found verbatim in the source: "${quotes[0].slice(0, 60)}".`)

    // Only capitalised month names count ("may" the verb and "march" the verb are not dates), and "May"
    // must sit beside a day or year so a surname such as Theresa May is not mistaken for a date.
    const monthNamed = (m: string) => {
      const cap = m[0].toUpperCase() + m.slice(1)
      return m === 'may' ? new RegExp(`\\b(\\d{1,2}(st|nd|rd|th)? May|May \\d{1,4})\\b`).test(text) : new RegExp(`\\b${cap}\\b`).test(text)
    }
    const monthsMissing = MONTHS.filter((m) => monthNamed(m) && !new RegExp(`\\b${m}\\b`, 'i').test(material))
    if (monthsMissing.length) fail('numbers_unsupported', `Date not found in the source: ${monthsMissing.join(', ')}.`)

    const haystack = new Set(wordsOf(material))
    const haystackStems = new Set([...haystack].map(stem))
    // A name is supported if the source has it, or a form of it ("created" supports "Create").
    const supported = (name: string, extra = new Set<string>()) => {
      const w = name.toLowerCase()
      return [w, w.replace(/s$/, ''), `${w}s`].some((v) => haystack.has(v) || extra.has(v)) || haystackStems.has(stem(w))
    }
    const summaryWords = new Set(wordsOf(summary))
    // Headlines are often written in Title Case, which capitalises every verb. In that case a capitalised word
    // that looks like an inflected verb or adverb is not treated as a name; name-like words still must be in the source.
    const headlineWords = headline.split(/\s+/).filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 4)
    const titleCase = headlineWords.length >= 4 && headlineWords.filter((w) => /^[A-Z]/.test(w)).length / headlineWords.length >= 0.6
    const verbish = (w: string) => /(?:s|es|ed|ing|ly|er)$/i.test(w)
    const headlineMissing = namesIn(headline).filter((n) => !supported(n, summaryWords) && !(titleCase && verbish(n)))
    const summaryMissing = namesIn(summary).filter((n) => !supported(n))
    if (headlineMissing.length) fail('entities_unsupported', `Names in the headline not found in the source: ${[...new Set(headlineMissing)].join(', ')}.`)
    else if (summaryMissing.length > LIMITS.maxUnsupportedEntities) fail('entities_unsupported', `Names in the summary not found in the source: ${[...new Set(summaryMissing)].join(', ')}.`)
    else if (summaryMissing.length) warnings.push(`A name in the summary was not found in the source: ${summaryMissing[0]}.`)

    const ratio = groundingRatio(summary, material)
    if (ratio < LIMITS.minGrounding) fail('weakly_grounded', `Only ${Math.round(ratio * 100)}% of the summary's wording is traceable to the source (need ${Math.round(LIMITS.minGrounding * 100)}%).`)

    // Meaning, not just vocabulary: negation, opposites, reversed roles, units, unsupported conclusions.
    const claims = checkClaims(headline, summary, material)
    for (const f of claims.findings) fail(f.kind === 'unsupported_conclusion' ? 'conclusion_unsupported' : 'claim_contradiction', f.message)
    unaligned = claims.unaligned
    for (const u of claims.unaligned) warnings.push(`Not found in the source, so only the claim check can confirm it: "${u.slice(0, 90)}".`)

    // Early-stage science and health must say so; and never be sold as a cure.
    if (['health', 'science'].includes(s.category) && PRELIMINARY_IN_SOURCE.test(material) && !HEDGE_IN_SUMMARY.test(summary))
      fail('preliminary_unqualified', 'The source describes preliminary or early-stage work, but the summary states it without qualification.')
  }

  return { ok: failures.length === 0, failures, warnings, unaligned }
}

// ── Choosing the five ───────────────────────────────────────────────────
export interface Candidate<T> {
  item: T
  headline: string
  sourceUrl: string
  /** Gate result, with any live-check failures (such as an unreachable link) already added. */
  result: GateResult
}

export interface Selection<T> {
  chosen: T[]
  rejected: { item: T; reasons: string[] }[]
}

/**
 * Walk the candidates in the order given (the five first, then the backups) and
 * keep the first five that pass and are not the same event as one already kept.
 * Fewer than five is a normal outcome: the caller must then publish nothing.
 */
export function selectFive<T>(candidates: Candidate<T>[], size = 5): Selection<T> {
  const chosen: Candidate<T>[] = []
  const rejected: Selection<T>['rejected'] = []
  for (const c of candidates) {
    if (!c.result.ok) {
      rejected.push({ item: c.item, reasons: c.result.failures.map((f) => f.message) })
      continue
    }
    if (chosen.length >= size) continue // a spare: neither used nor rejected
    const twin = chosen.find((k) => normalizeUrl(k.sourceUrl) === normalizeUrl(c.sourceUrl) || titleSimilarity(k.headline, c.headline) >= LIMITS.nearDuplicate)
    if (twin) {
      rejected.push({ item: c.item, reasons: [`Near-duplicate of "${twin.headline.slice(0, 60)}".`] })
      continue
    }
    chosen.push(c)
  }
  return { chosen: chosen.map((c) => c.item), rejected }
}

/** Human-readable one-liner for a list of failures. */
/** The capitalised names that a story's own text uses, for normalising its headline. */
export const namesInText = (...texts: string[]): string[] => texts.flatMap((t) => namesIn(t))

export const describe = (failures: Failure[]) => failures.map((f) => f.message).join(' ')
