import type { Candidate } from './types.ts'

const TRACKING = /^(utm_|fbclid|gclid|mc_|at_|ref$|source$|cmp$|ito$|ocid$)/i

/** Same article, different tracking link → same key. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key)
    u.hash = ''
    const host = u.hostname.replace(/^(www|m|amp)\./, '')
    const path = u.pathname.replace(/\/(amp\/?)?$/, '')
    const query = u.searchParams.toString()
    return `${host}${path}${query ? `?${query}` : ''}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

const STOP = new Set('a an the of to in on for and or but with from by at as is are was were be been has have had its it this that after over into new says say said will how why what'.split(' '))

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )
}

/** Jaccard overlap of the meaningful words in two headlines, 0–1. */
export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a)
  const B = titleTokens(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / (A.size + B.size - shared)
}

/** Which of two reports of the same story to keep. */
const better = (a: Candidate, b: Candidate) => (a.trust !== b.trust ? a.trust > b.trust : a.excerpt.length >= b.excerpt.length)

/**
 * Collapse identical articles (by URL) and substantially identical stories
 * (by headline overlap), keeping the best-sourced report of each. Anything
 * already used in a recent edition is dropped outright.
 */
export function dedupe(candidates: Candidate[], alreadyUsedUrls: string[] = [], threshold = 0.6): Candidate[] {
  const used = new Set(alreadyUsedUrls.map(normalizeUrl))
  const kept: Candidate[] = []
  const byUrl = new Map<string, number>()

  for (const candidate of candidates) {
    const key = normalizeUrl(candidate.url)
    if (used.has(key)) continue

    let at = byUrl.get(key) ?? -1
    if (at < 0) at = kept.findIndex((k) => titleSimilarity(k.title, candidate.title) >= threshold)

    if (at < 0) {
      byUrl.set(key, kept.length)
      kept.push(candidate)
    } else if (better(candidate, kept[at])) {
      kept[at] = candidate
      byUrl.set(key, at)
    }
  }
  return kept.map((c, i) => ({ ...c, id: `c${i + 1}` }))
}

/** Keep items published inside the window. Undated items are kept: the editor sees the date field is empty. */
export function withinWindow(candidates: Candidate[], hours: number, now = Date.now()): Candidate[] {
  const cutoff = now - hours * 3_600_000
  return candidates.filter((c) => {
    if (!c.publishedAt) return true
    const t = Date.parse(c.publishedAt)
    return t >= cutoff && t <= now + 3_600_000
  })
}
