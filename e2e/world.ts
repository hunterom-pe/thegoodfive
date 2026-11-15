/**
 * A fixture "internet" for end-to-end tests. Every network call the server makes is intercepted:
 * feeds, article pages, robots.txt, the AI provider, Unsplash and the alert webhook are served
 * from fixtures, and ANY other request is blocked and recorded, so a test can never reach a real
 * service. The articles are fictional and live only in memory and a throwaway database.
 */
import { FEEDS } from '../server/pipeline/feeds.ts'
import { story } from '../server/fixtures.ts'

export type AiMode = 'ok' | 'error500' | 'hang' | 'invent' | 'inventAll'

export interface WorldState {
  /** Which fixture articles exist (0-8 good ones from trusted publishers). */
  goodTrusted: number
  /** Good-looking stories on a site that is NOT a trusted source. */
  goodUntrusted: number
  /** Negative-news items (should be screened out). */
  bad: number
  feedsDown: boolean
  ai: AiMode
  unsplash: 'ok' | 'down'
  /** Article URLs that now return 404 (a link that rots between drafting and publishing). */
  gone: Set<string>
  /** Delay every AI answer by this many ms. */
  aiDelayMs: number
  /** The claim-by-claim check run before publishing: fine, unavailable, or finding a conflict in every story. */
  claimCheck: 'ok' | 'down' | 'conflict' | 'unsure'
  /** The alert webhook: delivering, answering with an error status, or unreachable. */
  webhook: 'ok' | 'http500' | 'down'
}

const TRUSTED = [
  { host: 'www.bbc.co.uk', path: '/news/articles', feed: 'BBC News (Science & Environment)', site: 'BBC News' },
  { host: 'www.theguardian.com', path: '/world/2026/nov/14', feed: 'The Guardian (The Upside)', site: 'The Guardian' },
  { host: 'news.mongabay.com', path: '/2026/11', feed: 'Mongabay', site: 'Mongabay' },
  { host: 'www.sciencedaily.com', path: '/releases/2026/11', feed: 'ScienceDaily', site: 'ScienceDaily' },
]

export interface Article { n: number; url: string; host: string; feedUrl: string; site: string; headline: string; body: string; hoursAgo: number; kind: 'good' | 'untrusted' | 'bad' }

const feedUrl = (name: string) => FEEDS.find((f) => f.name === name)!.url
const BAD_HEADLINES = ['Bombing kills dozens as talks collapse', 'Scandal deepens after fatal crash investigation', 'Floods leave thousands dead and homeless', 'Layoffs hit factory towns as lawsuit grows', 'Outbreak forces hospital closures amid crisis', 'Shooting prompts fresh fears across the city', 'Wildfire disaster destroys hundreds of homes', 'Tragedy as rescue attempt ends in deaths', 'Terror alert raised after attack plot', 'Court sues company over deadly collapse']

export function articles(w: WorldState): Article[] {
  const out: Article[] = []
  for (let i = 0; i < w.goodTrusted; i++) {
    const s = story(i % 8)
    const t = TRUSTED[i % TRUSTED.length]
    out.push({ n: i, url: `https://${t.host}${t.path}/e2e-${i}`, host: t.host, feedUrl: feedUrl(t.feed), site: t.site, headline: s.headline, body: s.sourceMaterial!, hoursAgo: 4 + i, kind: 'good' })
  }
  for (let i = 0; i < w.goodUntrusted; i++) {
    const s = story((i + 3) % 8)
    out.push({ n: 100 + i, url: `https://random-blog.example/post-${i}`, host: 'random-blog.example', feedUrl: feedUrl('Good News Network'), site: 'A Blog', headline: `${s.headline} (blog)`, body: s.sourceMaterial!, hoursAgo: 5 + i, kind: 'untrusted' })
  }
  for (let i = 0; i < w.bad; i++) {
    const t = TRUSTED[i % TRUSTED.length]
    out.push({ n: 200 + i, url: `https://${t.host}${t.path}/bad-${i}`, host: t.host, feedUrl: feedUrl(t.feed), site: t.site, headline: BAD_HEADLINES[i % BAD_HEADLINES.length], body: `${BAD_HEADLINES[i % BAD_HEADLINES.length]}. Officials said the situation remains serious and authorities are investigating what happened over several days, according to local reports from the region. `.repeat(4), hoursAgo: 3 + i, kind: 'bad' })
  }
  return out
}

const rss = (items: Article[]) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Fixture feed</title>${items
    .map((a) => `<item><title>${a.headline}</title><link>${a.url}</link><pubDate>${new Date(Date.now() - a.hoursAgo * 3_600_000).toUTCString()}</pubDate><description>${a.body.split('. ')[0]}.</description><media:content url="https://img.${a.host}/lead-${a.n}.jpg" medium="image"/></item>`)
    .join('')}</channel></rss>`

const page = (a: Article) =>
  `<html><head><title>${a.headline}</title><meta property="og:image" content="https://img.${a.host}/lead-${a.n}.jpg"><meta property="og:site_name" content="${a.site}"></head><body><article><h1>${a.headline}</h1>${a.body
    .split(/(?<=\.)\s+/)
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p.padEnd(62, ' ')}</p>`)
    .join('')}</article></body></html>`

const NEGATIVE = /\b(kill|dead|death|crash|scandal|bomb|shoot|terror|tragedy|disaster|layoff|lawsuit|outbreak|flood|collapse|sues)/i

/** A deterministic stand-in for the language model that answers the real prompts the pipeline sends. */
/**
 * The claim-by-claim reader. Honest like the real one has to be: a sentence is "supported" only when it is
 * really in the article, and it cites that sentence; anything else is "not_in_source".
 */
function fakeClaimCheck(user: string, mode: 'ok' | 'conflict' | 'down' | 'unsure'): unknown {
  // The real prompt lists each statement and, indented under it, its numbered clauses: "  [S1.2] and created jobs."
  const head = user.slice(0, user.indexOf('ARTICLE TEXT:'))
  const clauses = [...head.matchAll(/^\s+\[([A-Z][0-9]*\.[0-9]+)\] (.+)$/gm)].map((m) => ({ id: m[1], text: m[2] }))
  const statements = [...head.matchAll(/^\[([A-Z][0-9]*)\] (.+)$/gm)].map((m) => m[2])
  const article = user.slice(user.indexOf('ARTICLE TEXT:') + 13).trim()
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const sentences = article.split(/(?<=[.!?])\s+/)
  const unsure = mode === 'unsure' && statements.some((t) => /turtle/i.test(t))
  return {
    clauses: clauses.map(({ id, text }) => {
      // The headline paraphrases the article: the fake cites the opening sentence for it, as a real reader would.
      const evidence = id.startsWith('H.') ? sentences[0] : sentences.find((x) => norm(x).includes(norm(text)))
      const there = Boolean(evidence) && !unsure
      if (mode === 'conflict' && there) return { id, verdict: 'contradicted', evidence }
      return there ? { id, verdict: 'supported', evidence } : { id, verdict: 'not_in_source', evidence: '' }
    }),
  }
}

function fakeModel(body: { messages: { role: string; content: string }[]; response_format?: { json_schema?: { name?: string } } }, mode: AiMode, claimCheck: 'ok' | 'down' | 'conflict' | 'unsure' = 'ok'): unknown {
  const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
  const name = body.response_format?.json_schema?.name
  if (name === 'claim_check') return fakeClaimCheck(user, claimCheck)
  const list = JSON.parse(user.slice(user.indexOf('[')))
  if (name === 'screening') {
    return {
      evaluations: list.map((c: { id: string; headline: string }) => ({
        id: c.id, is_good_news: !NEGATIVE.test(c.headline), category: /salmon|turtle|bees/i.test(c.headline) ? 'nature' : /hearing|library|fridge/i.test(c.headline) ? 'humanity' : 'progress', significance: 4, credibility: 4, reason: 'A concrete positive development.',
      })),
    }
  }
  const stories = list.slice(0, 10).map((item: { id: string; original_headline: string; source_material: string }, i: number) => {
    let summary = item.source_material.split(/\s+/).slice(0, 72).join(' ').replace(/[,;]$/, '') + '.'
    if (mode === 'inventAll' || (mode === 'invent' && i < 2)) summary += ' The scheme cost 7,500 dollars.'
    return { id: item.id, role: i < 5 ? 'primary' : 'backup', category: /salmon|turtle|bees/i.test(item.original_headline) ? 'nature' : 'humanity', headline: item.original_headline, summary, why_good_news: 'A concrete, well-sourced local success.', preliminary: false, claims_to_check: ['Check the figures against the article.'], image_query: 'community nature', about_specific_person: false }
  })
  return { stories }
}

export interface Sent { url: string; init?: RequestInit }

export class World {
  state: WorldState = { goodTrusted: 8, goodUntrusted: 0, bad: 10, feedsDown: false, ai: 'ok', unsplash: 'ok', gone: new Set(), aiDelayMs: 0, claimCheck: 'ok', webhook: 'ok' }
  /** Everything fetched, so tests can assert what did (and did not) happen. */
  log: string[] = []
  blocked: string[] = []
  alerts: string[] = []
  /** Handler for the background function, installed by the test (it runs the real executeRun). */
  /** Called when the claim-by-claim check is asked a question: lets a test edit a story "while the check is running". */
  onClaimCheck?: () => void
  background?: (req: { secret: string | null; body: { runId?: string; date?: string } }) => Promise<number>
  private real?: typeof fetch

  install() {
    this.real = globalThis.fetch
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => this.fetch(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, init)) as typeof fetch
  }
  restore() {
    if (this.real) globalThis.fetch = this.real
  }
  reset(over: Partial<WorldState> = {}) {
    this.state = { goodTrusted: 8, goodUntrusted: 0, bad: 10, feedsDown: false, ai: 'ok', unsplash: 'ok', gone: new Set(), aiDelayMs: 0, claimCheck: 'ok', webhook: 'ok', ...over }
    this.log = []; this.blocked = []; this.alerts = []
  }
  calls = (needle: string) => this.log.filter((u) => u.includes(needle)).length

  private hang(init?: RequestInit): Promise<Response> {
    return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new DOMException('Aborted', 'AbortError'))))
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.log.push(url)
    const u = new URL(url)
    const text = (body: string, status = 200, type = 'text/html') => new Response(body, { status, headers: { 'content-type': type } })

    if (u.host === 'api.fake-llm.test') {
      if (this.state.aiDelayMs) await new Promise((r) => setTimeout(r, this.state.aiDelayMs))
      if (this.state.ai === 'hang') return this.hang(init)
      if (this.state.ai === 'error500') return text('{"error":"upstream failure"}', 500, 'application/json')
      const parsed = JSON.parse(String(init?.body))
      if (parsed.response_format?.json_schema?.name === 'claim_check') this.onClaimCheck?.()
      if (this.state.claimCheck === 'down' && parsed.response_format?.json_schema?.name === 'claim_check') return text('{"error":"claim check unavailable"}', 500, 'application/json')
      const content = JSON.stringify(fakeModel(parsed, this.state.ai, this.state.claimCheck))
      return text(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), 200, 'application/json')
    }
    if (u.host === 'hooks.example.com') {
      this.alerts.push(JSON.parse(String(init?.body)).text)
      if (this.state.webhook === 'down') throw new Error('connect ECONNREFUSED hooks.example.com')
      if (this.state.webhook === 'http500') return text('upstream error', 500)
      return text('ok')
    }
    if (u.host === 'e2e.site' && u.pathname.endsWith('/generate-draft-background')) {
      const h = new Headers(init?.headers)
      const status = this.background ? await this.background({ secret: h.get('x-generation-secret'), body: JSON.parse(String(init?.body)) }) : 404
      return text('', status)
    }
    if (u.host === 'api.unsplash.com') {
      if (this.state.unsplash === 'down') return text('{"errors":["unavailable"]}', 503, 'application/json')
      return text(JSON.stringify({ results: [] }), 200, 'application/json')
    }
    if (u.host === 'api.gdeltproject.org') return text('rate limited', 429)
    if (u.pathname === '/robots.txt') return text('User-agent: *\nDisallow: /private/\n', 200, 'text/plain')

    const all = articles(this.state)
    if (FEEDS.some((f) => f.url === url)) {
      if (this.state.feedsDown) return text('Service Unavailable', 503)
      return text(rss(all.filter((a) => a.feedUrl === url)), 200, 'application/rss+xml')
    }
    const article = all.find((a) => a.url === url)
    if (article) return this.state.gone.has(url) ? text('Not Found', 404) : text(page(article))

    this.blocked.push(url)
    throw new Error(`Blocked network call in an end-to-end test: ${url}`)
  }
}
