import { USER_AGENT } from './rss.ts'
import type { Candidate } from './types.ts'

interface GdeltArticle {
  url: string
  title: string
  seendate: string // 20261113T101500Z
  domain: string
  language: string
}

const seenToISO = (seen: string): string | null => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seen)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null
}

export function parseGdelt(json: unknown): Candidate[] {
  const articles = (json as { articles?: GdeltArticle[] })?.articles ?? []
  return articles
    .filter((a) => a.title && /^https?:\/\//i.test(a.url))
    .map((a) => ({
      id: '',
      title: a.title.replace(/\s+/g, ' ').trim(),
      url: a.url,
      sourceName: a.domain,
      publishedAt: seenToISO(a.seendate),
      // GDELT is an index of headlines. Any story chosen from it must have
      // its text retrieved before a summary is written (see pipeline.ts).
      excerpt: '',
      via: 'GDELT',
      trust: 1,
    }))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Query the GDELT DOC 2.0 API. GDELT asks for no more than one request
 * every five seconds, so queries run one at a time with a pause between.
 */
export async function fetchGdelt(queries: string[], hours: number, log: (line: string) => void): Promise<Candidate[]> {
  const found: Candidate[] = []
  for (const [i, query] of queries.entries()) {
    if (i > 0) await sleep(6_000)
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({
      query,
      mode: 'ArtList',
      format: 'json',
      maxrecords: '50',
      timespan: `${hours}h`,
      sort: 'HybridRel',
    })}`
    try {
      let res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) })
      if (res.status === 429) {
        // Rate limited: wait once, then move on. GDELT is a bonus source, never a blocker.
        await sleep(12_000)
        res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) })
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // GDELT reports query errors as plain text with a 200.
      const body = await res.text()
      found.push(...parseGdelt(JSON.parse(body)))
    } catch (e) {
      log(`GDELT query ${i + 1} skipped: ${e instanceof Error ? e.message : e}`)
    }
  }
  return found
}
