import { fetchArticle, type ArticleMaterial } from './article.ts'
import type { AiClient } from './ai.ts'
import { assemble, imagePlans, rank, screen, write, type Shortlisted } from './curate.ts'
import { attachImages, type ImageOptions } from './images.ts'
import { dedupe, withinWindow } from './dedupe.ts'
import { FEEDS, GDELT_QUERIES } from './feeds.ts'
import { fetchGdelt } from './gdelt.ts'
import { fetchFeed } from './rss.ts'
import { stripHtml } from './text.ts'
import type { Candidate, DraftStory } from './types.ts'

export interface PipelineOptions {
  ai: AiClient
  log?: (line: string) => void
  now?: Date
  /** The edition's calendar day (YYYY-MM-DD), shown to the model as "today". */
  today: string
  /** URLs used in recent editions: never offered again. */
  recentUrls?: string[]
  /** Hours of news to consider. Default 72. */
  windowHours?: number
  /** Overridable for tests. */
  discover?: (log: (line: string) => void) => Promise<Candidate[]>
  fetchMaterial?: (url: string) => Promise<ArticleMaterial | null>
  /** Photo settings. Without an Unsplash key only the article's own image is offered, unapproved. */
  images?: ImageOptions
}

export interface PipelineResult {
  stories: DraftStory[]
  stats: Record<string, number>
}

/** Cost guard: never send more than this many candidates to the screening call. */
const SCREEN_LIMIT = 60
/** Candidates whose full text we fetch and hand to the writing call. */
const SHORTLIST_SIZE = 14
/** Below this much source text we can't summarise accurately, so the story is excluded. */
const MIN_MATERIAL_CHARS = 350

/** Every provider is optional: one failing feed never fails the run. */
export async function discoverAll(log: (line: string) => void): Promise<Candidate[]> {
  const feeds = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)))
  const found: Candidate[] = []
  let ok = 0
  feeds.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      ok++
      found.push(...result.value)
    } else log(`Feed skipped: ${FEEDS[i].name} (${result.reason instanceof Error ? result.reason.message : result.reason})`)
  })
  log(`RSS: ${ok}/${FEEDS.length} feeds responded, ${found.length} items`)
  const gdelt = await fetchGdelt(GDELT_QUERIES, 72, log)
  log(`GDELT: ${gdelt.length} items`)
  return [...found, ...gdelt]
}

/** Pool bounded concurrency without a dependency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/**
 * Pick up to `limit` candidates, newest first, taking turns across sources so
 * one prolific feed (hundreds of research papers) cannot crowd out the rest.
 */
export function interleave(candidates: Candidate[], limit: number): Candidate[] {
  const bySource = new Map<string, Candidate[]>()
  for (const c of [...candidates].sort((a, b) => Date.parse(b.publishedAt ?? '0') - Date.parse(a.publishedAt ?? '0'))) {
    bySource.set(c.via, [...(bySource.get(c.via) ?? []), c])
  }
  // Fewest-items sources first, so small, high-signal feeds always get their turn.
  const queues = [...bySource.values()].sort((a, b) => a.length - b.length)
  const out: Candidate[] = []
  for (let round = 0; out.length < limit && queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round] && out.length < limit) out.push(q[round])
  }
  return out
}

const materialFor = (candidate: Candidate, article: ArticleMaterial | null): string => {
  const body = article?.text ?? ''
  const fallback = [article?.description, candidate.excerpt].filter(Boolean).join('\n\n')
  // Prefer the publisher's own page; fall back to what their feed gave us.
  return stripHtml(body.length >= MIN_MATERIAL_CHARS ? body : fallback || body)
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const log = options.log ?? (() => {})
  const now = (options.now ?? new Date()).getTime()
  const stats: Record<string, number> = {}

  // 1. Discover and narrow.
  const raw = await (options.discover ?? discoverAll)(log)
  stats.discovered = raw.length
  const unique = dedupe(withinWindow(raw, options.windowHours ?? 72, now), options.recentUrls ?? [])
  stats.afterDedupe = unique.length
  const pool = interleave(unique, SCREEN_LIMIT)
  stats.screened = pool.length
  log(`${raw.length} found → ${unique.length} unique and recent → ${pool.length} screened`)
  if (pool.length < 8) {
    log('Too few candidates to build an edition.')
    return { stories: [], stats }
  }

  // 2. Screen on headline and excerpt (one AI call).
  log('Screening candidates with AI…')
  const t0 = Date.now()
  const evaluations = await screen(options.ai, pool, options.today)
  log(`Screening took ${Math.round((Date.now() - t0) / 1000)}s`)
  const ranked = rank(pool, evaluations, now, SHORTLIST_SIZE)
  stats.qualified = evaluations.filter((e) => e.isGoodNews).length
  stats.shortlisted = ranked.length
  log(`${stats.qualified} judged good news → ${ranked.length} shortlisted`)

  // 3. Read the shortlisted stories (robots.txt respected) and drop any we can't support.
  const fetchMaterial = options.fetchMaterial ?? fetchArticle
  const withMaterial = await mapLimit(ranked, 5, async (r): Promise<Shortlisted> => {
    const article = await fetchMaterial(r.candidate.url)
    return { ...r, material: materialFor(r.candidate, article), images: article?.images ?? [] }
  })
  const shortlist = withMaterial.filter((s) => s.material.length >= MIN_MATERIAL_CHARS).map((s) => ({ ...s, material: s.material.slice(0, 3000) }))
  stats.withSourceText = shortlist.length
  log(`${shortlist.length} of ${ranked.length} had enough source text to summarise`)
  if (shortlist.length === 0) return { stories: [], stats }

  // 4. Choose and write (one AI call), then verify the writing against the source text.
  log('Writing the edition with AI…')
  const t1 = Date.now()
  const written = await write(options.ai, shortlist, options.today)
  log(`Writing took ${Math.round((Date.now() - t1) / 1000)}s`)
  const drafted = assemble(written, shortlist, log)
  const sources = new Map(shortlist.map((s) => [s.candidate.url, { candidate: s.candidate, hints: s.images ?? [] }]))
  const stories = await attachImages(drafted, sources, imagePlans(written, shortlist), { log, ...options.images })
  stats.primary = stories.filter((s) => s.role === 'primary').length
  stats.backup = stories.filter((s) => s.role === 'backup').length
  stats.withImage = stories.filter((s) => s.image_url).length
  stats.imageApproved = stories.filter((s) => s.image_rights_confirmed).length
  log(`Drafted ${stats.primary} primary and ${stats.backup} backup stories; ${stats.withImage} with a photo, ${stats.imageApproved} licensed and cleared`)
  return { stories, stats }
}
