import { USER_AGENT } from './rss.ts'
import { decodeEntities, stripHtml, truncate } from './text.ts'

export interface ArticleMaterial {
  siteName: string | null
  description: string | null
  /** Body text recovered from the page's paragraphs. May be empty (paywalls, scripts). */
  text: string
}

const meta = (html: string, name: string): string | null => {
  const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0]
  const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1]
  return content ? decodeEntities(content).trim() : null
}

/**
 * Pull readable text out of an article page. Deliberately simple: the goal
 * is enough of the publisher's own words to ground a 60–100 word summary,
 * not a perfect reader view.
 */
export function extractArticle(html: string, maxChars = 6_000): ArticleMaterial {
  const scope = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html
  const paragraphs = [...scope.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)]
    .map((m) => stripHtml(m[0]))
    // Short fragments are usually captions, bylines and cookie notices.
    .filter((p) => p.length >= 60)
  return {
    siteName: meta(html, 'og:site_name'),
    description: meta(html, 'og:description') ?? meta(html, 'description'),
    text: truncate(paragraphs.join('\n\n'), maxChars),
  }
}

const robotsCache = new Map<string, string[]>()

/** Disallowed path prefixes for `*` from a site's robots.txt (cached per host). A missing robots.txt means no restrictions. */
async function disallowed(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin)
  if (cached) return cached
  const rules: string[] = []
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5_000) })
    if (res.ok) {
      let applies = false
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim()
        const [key, ...rest] = line.split(':')
        const value = rest.join(':').trim()
        if (/^user-agent$/i.test(key)) applies = value === '*' || /thegoodfive/i.test(value)
        else if (applies && /^disallow$/i.test(key) && value) rules.push(value)
      }
    }
  } catch {
    /* unreachable robots.txt: treat as no restrictions */
  }
  robotsCache.set(origin, rules)
  return rules
}

export async function allowedByRobots(url: string): Promise<boolean> {
  try {
    const u = new URL(url)
    const rules = await disallowed(u.origin)
    const target = u.pathname + u.search
    return !rules.some((rule) => new RegExp(`^${rule.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$')}`).test(target))
  } catch {
    return false
  }
}

export async function fetchArticle(url: string, timeoutMs = 9_000): Promise<ArticleMaterial | null> {
  try {
    if (!(await allowedByRobots(url))) return null
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
    return extractArticle((await res.text()).slice(0, 1_500_000))
  } catch {
    return null
  }
}
