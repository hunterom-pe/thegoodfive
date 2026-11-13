import type { AiClient } from './ai.ts'
import { truncate } from './text.ts'
import { CATEGORIES, type Candidate, type Category, type DraftStory, type Evaluation } from './types.ts'

const categoryEnum = { type: 'string', enum: CATEGORIES }

// ── Stage 1: screen every candidate on its headline and excerpt ─────────

const SCREEN_SYSTEM = `You screen news for The Good Five, a daily publication of five genuinely good news stories.
For each candidate (headline and short excerpt only) decide whether it reports a real, substantive positive development.

Mark is_good_news = false for: tragedy framed as positive without meaningful justification; promotional or sponsored material, product launches and fundraising appeals; celebrity gossip and viral trivia; opinion pieces; headlines that promise more than the excerpt supports; claims with no apparent evidence; purely political horse-race stories.

significance (1-5): 5 = benefits many people or marks real, lasting progress; 3 = solid and meaningful; 1 = trivial or very local novelty.
credibility (1-5): judge the outlet, the specificity of the report and any named evidence (institutions, studies, figures). When the excerpt is thin, score lower, not higher.
category: the best fit among humanity (kindness, community), health (medical and public health), science (discovery, technology), nature (wildlife, environment), progress (social, economic and global development).
reason: one short sentence. Use only what is written in the candidate; never add outside facts.`

const SCREEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluations'],
  properties: {
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'is_good_news', 'category', 'significance', 'credibility', 'reason'],
        properties: {
          id: { type: 'string' },
          is_good_news: { type: 'boolean' },
          category: categoryEnum,
          significance: { type: 'integer', minimum: 1, maximum: 5 },
          credibility: { type: 'integer', minimum: 1, maximum: 5 },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const

export async function screen(ai: AiClient, candidates: Candidate[], today: string): Promise<Evaluation[]> {
  const list = candidates.map((c) => ({
    id: c.id,
    headline: c.title,
    outlet: c.sourceName,
    published: c.publishedAt?.slice(0, 10) ?? 'unknown',
    excerpt: truncate(c.excerpt, 300),
  }))
  const result = await ai.json<{
    evaluations: { id: string; is_good_news: boolean; category: Category; significance: number; credibility: number; reason: string }[]
  }>({
    system: SCREEN_SYSTEM,
    user: `Today is ${today}. Screen these ${list.length} candidates.\n\n${JSON.stringify(list)}`,
    name: 'screening',
    schema: SCREEN_SCHEMA,
    maxTokens: 8000,
  })
  const known = new Set(candidates.map((c) => c.id))
  return result.evaluations
    .filter((e) => known.has(e.id))
    .map((e) => ({ id: e.id, isGoodNews: e.is_good_news, category: e.category, significance: e.significance, credibility: e.credibility, reason: e.reason }))
}

/** Best first. Significance counts double; a trusted outlet and a fresh story break ties. */
export function rank(candidates: Candidate[], evaluations: Evaluation[], now: number, keep: number): { candidate: Candidate; evaluation: Evaluation }[] {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  return evaluations
    .filter((e) => e.isGoodNews && e.credibility >= 3 && e.significance >= 2 && byId.has(e.id))
    .map((evaluation) => {
      const candidate = byId.get(evaluation.id)!
      const ageHours = candidate.publishedAt ? (now - Date.parse(candidate.publishedAt)) / 3_600_000 : 48
      const fresh = ageHours <= 36 ? 1 : 0
      return { candidate, evaluation, score: evaluation.significance * 2 + evaluation.credibility + candidate.trust + fresh }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, keep)
    .map(({ candidate, evaluation }) => ({ candidate, evaluation }))
}

// ── Stage 2: choose five plus three and write them, from source text only ─

const WRITE_SYSTEM = `You are the editor of The Good Five, a daily publication of five genuinely good news stories. Tone: warm, intelligent, grounded, optimistic without gushing. Journalistic, never clickbait, never generic AI phrasing.

You receive up to 14 shortlisted stories, each with SOURCE MATERIAL retrieved from the publisher. Choose the best five (primary) and up to three backups (backup), then write each one.

Selection: genuine positive impact, credibility, significance, freshness and variety of subject. Prefer meaningful progress over trivial or viral items. Do not force category quotas, but do not run five stories on the same kind of news if equally strong alternatives exist. If fewer than eight stories qualify, return only those that do (primary first); never pad the list. If the source material is too thin to summarise accurately, leave the story out.

Writing rules (strict):
- Use ONLY facts that appear in that story's SOURCE MATERIAL. Never add background, context, numbers, names, quotations or conclusions from your own knowledge.
- Do not put quotation marks around anything unless the exact words appear in the source material.
- Every number, percentage, date and name in your text must appear in the source material.
- Distinguish confirmed results from preliminary research ("early findings", "in a small study", "researchers hope"). Set preliminary = true when the source describes early-stage, unreplicated or not-yet-peer-reviewed work. Never state medical conclusions more strongly than the source does.
- Headline: clear, specific, under 90 characters, no clickbait, no exclamation marks, no question headlines.
- Summary: 60 to 100 words, plain prose, a single paragraph, in your own words (do not copy sentences from the source).
- why_good_news: one sentence on why this counts as good news.
- claims_to_check: 1 to 3 specific claims from your text that a human should verify against the original.`

const WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stories'],
  properties: {
    stories: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'role', 'category', 'headline', 'summary', 'why_good_news', 'preliminary', 'claims_to_check'],
        properties: {
          id: { type: 'string' },
          role: { type: 'string', enum: ['primary', 'backup'] },
          category: categoryEnum,
          headline: { type: 'string' },
          summary: { type: 'string' },
          why_good_news: { type: 'string' },
          preliminary: { type: 'boolean' },
          claims_to_check: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

export interface Shortlisted {
  candidate: Candidate
  evaluation: Evaluation
  /** Text retrieved from the publisher: the only factual basis for the summary. */
  material: string
}

interface WrittenStory {
  id: string
  role: 'primary' | 'backup'
  category: Category
  headline: string
  summary: string
  why_good_news: string
  preliminary: boolean
  claims_to_check: string[]
}

export async function write(ai: AiClient, shortlist: Shortlisted[], today: string): Promise<WrittenStory[]> {
  const items = shortlist.map((s) => ({
    id: s.candidate.id,
    outlet: s.candidate.sourceName,
    published: s.candidate.publishedAt?.slice(0, 10) ?? 'unknown',
    original_headline: s.candidate.title,
    screening_note: s.evaluation.reason,
    source_material: s.material,
  }))
  const result = await ai.json<{ stories: WrittenStory[] }>({
    system: WRITE_SYSTEM,
    user: `Today is ${today}. Shortlist:\n\n${JSON.stringify(items)}`,
    name: 'edition',
    schema: WRITE_SCHEMA,
    maxTokens: 9000,
  })
  return result.stories
}

// ── Checks that don't trust the model ───────────────────────────────────

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

const normalise = (text: string) =>
  text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase()

/** Quoted passages in the text that do not appear verbatim in the source. */
export function ungroundedQuotes(text: string, material: string): string[] {
  const haystack = normalise(material)
  const quotes = [...text.matchAll(/[“"]([^”"]{12,})[”"]/g)].map((m) => m[1])
  return quotes.filter((q) => !haystack.includes(normalise(q).replace(/[.,;!?]+$/, '')))
}

const numbersIn = (text: string) => new Set([...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '')))

/** Figures in the text that never appear in the source (a sign of invention, or of numbers spelled out). */
export function ungroundedNumbers(text: string, material: string): string[] {
  const known = numbersIn(material)
  return [...numbersIn(text)].filter((n) => !known.has(n))
}

/**
 * Turn the model's answer into storable stories. Anything that fails a check
 * is excluded rather than repaired: the model could not support it.
 */
export function assemble(written: WrittenStory[], shortlist: Shortlisted[], log: (line: string) => void = () => {}): DraftStory[] {
  const byId = new Map(shortlist.map((s) => [s.candidate.id, s]))
  const seen = new Set<string>()
  const accepted: { story: WrittenStory; source: Shortlisted; notes: string[] }[] = []

  for (const story of written) {
    const source = byId.get(story.id)
    if (!source) {
      log(`Dropped unknown story id ${story.id}`)
      continue
    }
    if (seen.has(story.id)) continue
    seen.add(story.id)

    const headline = story.headline.trim()
    const summary = story.summary.replace(/\s+/g, ' ').trim()
    const words = wordCount(summary)
    if (!headline || headline.length > 200 || words < 35 || words > 140) {
      log(`Dropped "${headline.slice(0, 40)}": headline or summary length unusable (${words} words)`)
      continue
    }
    const quotes = ungroundedQuotes(`${headline} ${summary}`, source.material)
    if (quotes.length) {
      log(`Dropped "${headline.slice(0, 40)}": quotation not found in source`)
      continue
    }

    const notes: string[] = []
    const numbers = ungroundedNumbers(`${headline} ${summary}`, source.material)
    if (numbers.length) notes.push(`Figure not found in the retrieved text: ${numbers.join(', ')}. Verify against the original.`)
    if (words < 60 || words > 100) notes.push(`Summary is ${words} words (target 60–100).`)
    if (story.preliminary) notes.push('The source describes this as preliminary or early-stage. Keep the wording cautious.')
    accepted.push({ story: { ...story, headline, summary }, source, notes })
  }

  // Five primaries at most, three backups at most, in the model's order.
  const primaries = accepted.filter((a) => a.story.role === 'primary').slice(0, 5)
  const overflow = accepted.filter((a) => !primaries.includes(a) && a.story.role === 'primary')
  const backups = [...accepted.filter((a) => a.story.role === 'backup'), ...overflow].slice(0, 3)

  const toDraft = (a: (typeof accepted)[number], role: 'primary' | 'backup', position: number): DraftStory => ({
    role,
    position,
    category: a.story.category,
    headline: a.story.headline,
    summary: a.story.summary,
    source_name: a.source.candidate.sourceName,
    source_url: a.source.candidate.url,
    source_published_at: a.source.candidate.publishedAt,
    original_title: a.source.candidate.title,
    original_excerpt: truncate(a.source.material, 700),
    discovered_via: a.source.candidate.via,
    ai_rationale: a.story.why_good_news,
    claims_to_check: [...a.story.claims_to_check.slice(0, 3), ...a.notes],
  })

  return [...primaries.map((a, i) => toDraft(a, 'primary', i + 1)), ...backups.map((a, i) => toDraft(a, 'backup', i + 1))]
}
