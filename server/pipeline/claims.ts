import { clausesOf, meaningWords } from './verify.ts'

/**
 * Claim-level checks: does what the summary SAYS match what the source says?
 *
 * Word overlap (gates.ts) shows a summary is built from the source's vocabulary. It cannot tell
 * "counted 1,140" from "did not count 1,140". These checks look at meaning-bearing details instead:
 * negation, opposites, who did what to whom, numbers with their units, and conclusions the source
 * never draws. They are heuristics: they catch the common ways a faithful-sounding summary goes
 * wrong, they will not catch everything, and they do not prove a claim is true. Anything they
 * cannot settle is reported as "unaligned" so a stronger check (or a person) has to look.
 */
export type FindingKind = 'contradiction' | 'swapped_actors' | 'unit_mismatch' | 'unsupported_conclusion'

export interface ClaimFinding {
  kind: FindingKind
  /** Plain-English explanation for the editor. */
  message: string
  /** The summary sentence concerned. */
  claim: string
}

export interface ClaimReport {
  findings: ClaimFinding[]
  /** Summary sentences that could not be matched to any sentence of the source at all. */
  unaligned: string[]
}

const STOP = new Set(
  `the this that these those there their they then than with from into over under after before about across during while when where which what who whom whose why how and but for nor yet not has have had was were been being are its it's our your his her him she he we you a an as at by in of on or to up is be do did does can may will would could should might must also still new more most some many each every both either neither one two three four five six seven eight nine ten`.split(
    /\s+/,
  ),
)

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+(?=[A-Z“"'‘(])/).map((s) => s.trim()).filter((s) => s.length > 3)
const tokensOf = (text: string): string[] => text.toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/[’']s\b/g, '').replace(/n['’]t\b/g, ' not').replace(/[^a-z0-9.\s-]/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').split(/\s+/).filter(Boolean)

/** A crude stem: "counted", "counting" and "count" meet. */
export function lemma(word: string): string {
  let w = word.toLowerCase()
  if (w.length > 5) w = w.replace(/(ing|ed|es|ly)$/, '')
  else if (w.length > 4) w = w.replace(/(ed|s)$/, '')
  if (w.length > 4) w = w.replace(/s$/, '')
  return w.slice(0, 7)
}

const content = (tokens: string[]): string[] => tokens.filter((t) => (t.length >= 4 || /\d/.test(t)) && !STOP.has(t)).map(lemma)

/** Which source sentence a summary sentence was written from, if any. */
function align(sentence: string, source: string[]): { index: number; shared: number } | null {
  const mine = new Set(content(tokensOf(sentence)))
  if (mine.size < 3) return null
  let best = { index: -1, shared: 0, ratio: 0 }
  source.forEach((s, index) => {
    const theirs = new Set(content(tokensOf(s)))
    let shared = 0
    for (const m of mine) if (theirs.has(m)) shared++
    const ratio = shared / mine.size
    if (shared > best.shared || (shared === best.shared && ratio > best.ratio)) best = { index, shared, ratio }
  })
  return best.shared >= 3 && best.ratio >= 0.3 ? { index: best.index, shared: best.shared } : null
}

// ── Negation ───────────────────────────────────────────────────────────
const NEGATORS = new Set(['not', 'no', 'never', 'none', 'nobody', 'neither', 'nor', 'without', 'cannot', 'unable', 'fail', 'fails', 'failed', 'refused', 'refuse', 'denied', 'deny', 'lack', 'lacks', 'lacked'])

/** Content stems that fall within a few words after a negating word. */
function negatedStems(tokens: string[]): Set<string> {
  const out = new Set<string>()
  tokens.forEach((t, i) => {
    if (!NEGATORS.has(t)) return
    let taken = 0
    for (let j = i + 1; j < tokens.length && j <= i + 6 && taken < 4; j++) {
      if (NEGATORS.has(tokens[j])) break
      if ((tokens[j].length >= 4 || /\d/.test(tokens[j])) && !STOP.has(tokens[j])) {
        out.add(lemma(tokens[j]))
        taken++
      }
    }
  })
  return out
}

// ── Opposites ──────────────────────────────────────────────────────────
const OPPOSITES: [string, string][] = [
  ['increase', 'decrease'], ['rise', 'fall'], ['rose', 'fell'], ['grew', 'shrank'], ['gain', 'loss'], ['won', 'lost'], ['win', 'lose'],
  ['approve', 'reject'], ['approved', 'rejected'], ['raised', 'cut'], ['higher', 'lower'], ['more', 'fewer'], ['more', 'less'], ['expanded', 'reduced'],
  ['passed', 'failed'], ['succeeded', 'failed'], ['accepted', 'refused'], ['opened', 'closed'], ['reopened', 'closed'], ['improved', 'worsened'],
  ['recovered', 'declined'], ['halted', 'resumed'], ['banned', 'allowed'], ['launched', 'cancelled'], ['for', 'against'],
]

// ── Quantities with their units ────────────────────────────────────────
interface Quantity {
  value: number
  unit: string
  /** per day / week / month / year, if stated. */
  rate: string
  raw: string
}

const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mn: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12 }
const RATE = /^(day|daily|week|weekly|month|monthly|year|yearly|annual|annually|hour|hourly|minute)$/

export function quantitiesIn(text: string): Quantity[] {
  const out: Quantity[] = []
  const R = '(day|week|month|year|hour|minute)'
  const re = new RegExp(`([$£€])?\\s?(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s?(%|percent|per cent|thousand|million|billion|trillion|bn|mn|k\\b|m\\b))?(?:\\s+(?:(?:a|an|per|each|every)\\s+${R}\\b|([A-Za-z][A-Za-z-]*)(?:\\s+(?:a|an|per|each|every)\\s+${R}\\b)?))?`, 'gi')
  for (const m of text.matchAll(re)) {
    let value = parseFloat(m[2].replace(/,/g, ''))
    if (Number.isNaN(value)) continue
    let unit = ''
    const scaleWord = (m[3] ?? '').toLowerCase()
    const next = (m[5] ?? '').toLowerCase()
    if (scaleWord === '%' || scaleWord === 'percent' || scaleWord === 'per cent') unit = '%'
    else if (scaleWord && SCALE[scaleWord]) value *= SCALE[scaleWord]
    // "1.2 million people": the word after the scale is the unit; without a scale word it is the next word.
    if (!unit) {
      if (m[1]) unit = m[1]
      else if (next && !STOP.has(next) && !/^(of|to|and|or)$/.test(next) && !MONTH.test(next) && !RATE.test(next)) unit = lemma(next)
    }
    const rate = (m[4] ?? m[6] ?? '').toLowerCase() || (RATE.test(next) ? next.replace(/ly$/, '').replace(/^dai$/, 'day') : '')
    out.push({ value, unit, rate, raw: m[0].trim() })
  }
  return out
}
const MONTH = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/

/** Numbers that appear in the source, but with a different unit, scale or rate than the summary gives them. */
export function unitMismatches(summary: string, material: string): string[] {
  const src = quantitiesIn(material)
  const issues: string[] = []
  for (const q of quantitiesIn(summary)) {
    if (q.value >= 1900 && q.value <= 2100 && !q.unit) continue // a year
    const same = src.filter((s) => s.value === q.value)
    if (same.length === 0) continue // a figure absent from the source is reported by the figure check
    const unitOk = same.some((s) => !q.unit || !s.unit || s.unit === q.unit)
    const rateOk = same.some((s) => !q.rate || !s.rate || s.rate === q.rate)
    if (!unitOk) issues.push(`"${q.raw}" is given with a different unit in the source ("${same[0].raw}").`)
    else if (!rateOk) issues.push(`"${q.raw}" is given per ${q.rate} but the source says per ${same[0].rate}.`)
  }
  return issues
}

// ── Who did what to whom ───────────────────────────────────────────────
interface Mention {
  name: string
  at: number
}

function mentions(sentence: string): Mention[] {
  const words = sentence.split(/\s+/)
  const out: Mention[] = []
  words.forEach((raw, i) => {
    const t = raw.replace(/^[("“'‘]+|[)”"'’.,;:!?]+$/g, '').replace(/[’']s$/, '')
    if (i > 0 && /^[A-Z][A-Za-z'’-]{2,}$/.test(t) && !STOP.has(t.toLowerCase())) out.push({ name: t.toLowerCase(), at: i })
  })
  return out
}

const between = (sentence: string, a: number, b: number): string[] => sentence.split(/\s+/).slice(Math.min(a, b) + 1, Math.max(a, b)).map((w) => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean)

/** "A thanked B" against "A was thanked by B" or "B thanked A": same two names, same verb, roles reversed. */
export function swappedActors(summarySentence: string, sourceSentence: string): string | null {
  const a = mentions(summarySentence)
  const b = mentions(sourceSentence)
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const first = a[i]
      const second = a[j]
      if (first.name === second.name) continue
      const f = b.find((m) => m.name === first.name)
      const s = b.find((m) => m.name === second.name)
      if (!f || !s) continue
      const mid = between(summarySentence, first.at, second.at)
      const midSource = between(sourceSentence, f.at, s.at)
      const verbs = mid.filter((w) => w.length >= 4 && !STOP.has(w) && w !== 'by').map(lemma)
      const sourceVerbs = new Set(midSource.filter((w) => w.length >= 4 && !STOP.has(w) && w !== 'by').map(lemma))
      if (!verbs.some((v) => sourceVerbs.has(v))) continue // a different verb: not comparable
      const sameOrder = f.at < s.at
      const passiveSummary = mid.includes('by')
      const passiveSource = midSource.includes('by')
      if ((sameOrder && passiveSummary !== passiveSource) || (!sameOrder && passiveSummary === passiveSource)) {
        return `The summary has ${first.name[0].toUpperCase() + first.name.slice(1)} and ${second.name[0].toUpperCase() + second.name.slice(1)} in the opposite roles to the source.`
      }
    }
  }
  return null
}

// ── Conclusions the source does not draw ───────────────────────────────
const CAUSAL = /\b(because|caused?|causing|led to|leading to|results? in|resulted in|thanks to|due to|as a result|owing to|consequently|therefore|which is why|credited with)\b/i
const ABSOLUTE = /\b(first[- ]ever|the first|never before|largest|biggest|smallest|fastest|highest|lowest|record|always|entirely|guaranteed|proven|cured|eliminated|eradicated|solved|ended)\b/i

// ── Putting it together ────────────────────────────────────────────────
export function checkClaims(headline: string, summary: string, material: string): ClaimReport {
  const findings: ClaimFinding[] = []
  const unaligned: string[] = []
  const source = sentencesOf(material)
  const text = `${headline}. ${summary}`

  for (const sentence of sentencesOf(summary)) {
    const hit = align(sentence, source)
    if (!hit) {
      unaligned.push(sentence)
    } else {
      const src = source[hit.index]
      const sTokens = tokensOf(sentence)
      const rTokens = tokensOf(src)

      // Negation: "did not count" against "counted", and the reverse.
      const negS = negatedStems(sTokens)
      const negR = negatedStems(rTokens)
      const stemsS = new Set(content(sTokens))
      const stemsR = new Set(content(rTokens))
      const flipped = [...negS].filter((x) => !negR.has(x) && stemsR.has(x)).concat([...negR].filter((x) => !negS.has(x) && stemsS.has(x)))
      if (flipped.length) findings.push({ kind: 'contradiction', claim: sentence, message: `Negation differs from the source around "${flipped[0]}": one says it did not happen, the other that it did.` })

      // Opposite words.
      for (const [x, y] of OPPOSITES) {
        const inS = (w: string) => sTokens.includes(w)
        const inR = (w: string) => rTokens.includes(w)
        if ((inS(x) && inR(y) && !inR(x) && !inS(y)) || (inS(y) && inR(x) && !inR(y) && !inS(x))) {
          findings.push({ kind: 'contradiction', claim: sentence, message: `The summary says "${inS(x) ? x : y}" where the source says "${inR(x) ? x : y}".` })
          break
        }
      }

      const swap = swappedActors(sentence, src)
      if (swap) findings.push({ kind: 'swapped_actors', claim: sentence, message: swap })

      // A causal claim needs a causal statement nearby in the source.
      if (CAUSAL.test(sentence)) {
        const near = source.slice(Math.max(0, hit.index - 1), hit.index + 2).join(' ')
        if (!CAUSAL.test(near)) findings.push({ kind: 'unsupported_conclusion', claim: sentence, message: `The summary states a cause ("${sentence.match(CAUSAL)?.[0]}"), but the source sentence does not.` })
      }
    }
    // Absolute claims ("first ever", "cured") must be the source's own words, wherever the sentence aligns.
    const abs = sentence.match(ABSOLUTE)?.[0]
    if (abs && !new RegExp(`\\b${abs.replace(/[-\s]/g, '[-\\s]')}`, 'i').test(material)) findings.push({ kind: 'unsupported_conclusion', claim: sentence, message: `The summary says "${abs}", which the source does not.` })
  }

  for (const message of unitMismatches(text, material)) findings.push({ kind: 'unit_mismatch', claim: text.slice(0, 120), message })

  // A sentence can match the source as a whole while one clause of it ("... and created jobs") appears nowhere
  // in it. Report such clauses: these checks cannot confirm them, so the claim verifier has to.
  const sourceWords = new Set(meaningWords(material))
  for (const sentence of sentencesOf(summary)) {
    for (const clause of clausesOf(sentence)) {
      const words = meaningWords(clause)
      const found = words.filter((w) => sourceWords.has(w)).length
      if (words.length >= 1 && found / words.length < 0.5 && !unaligned.includes(sentence)) unaligned.push(clause)
    }
  }
  return { findings, unaligned }
}
