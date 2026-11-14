import { USER_AGENT } from './rss.ts'
import { decodeEntities, stripHtml, truncate } from './text.ts'

export interface ImageHint {
  url: string
  source: 'og:image' | 'twitter:image' | 'json-ld' | 'rss'
}

export interface ArticleMaterial {
  siteName: string | null
  description: string | null
  /** The article's own featured image(s). Candidates only: finding one grants no right to publish it. */
  images: ImageHint[]
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
const resolveImage = (value: unknown, base: string): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(decodeEntities(value.trim()), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Every `image` mentioned by Article-like JSON-LD nodes (string, ImageObject or a list of either). */
function jsonLdImages(html: string, base: string): string[] {
  const found: string[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    const type = JSON.stringify(obj['@type'] ?? '')
    if (/Article|BlogPosting|Report/i.test(type) && obj.image !== undefined) {
      const images = Array.isArray(obj.image) ? obj.image : [obj.image]
      for (const image of images) {
        const url = resolveImage(typeof image === 'string' ? image : (image as { url?: unknown })?.url, base)
        if (url) found.push(url)
      }
    }
    if (obj['@graph']) visit(obj['@graph'])
  }
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1]))
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  }
  return found
}

/** Open Graph, Twitter card and JSON-LD images, in that order, de-duplicated and resolved to absolute http(s) URLs. */
export function extractImages(html: string, base: string): ImageHint[] {
  const raw: ImageHint[] = []
  const add = (value: string | null, source: ImageHint['source']) => {
    const url = resolveImage(value, base)
    if (url) raw.push({ url, source })
  }
  add(meta(html, 'og:image:secure_url') ?? meta(html, 'og:image'), 'og:image')
  add(meta(html, 'twitter:image') ?? meta(html, 'twitter:image:src'), 'twitter:image')
  for (const url of jsonLdImages(html, base)) add(url, 'json-ld')
  const seen = new Set<string>()
  return raw.filter((h) => !seen.has(h.url) && seen.add(h.url))
}

export function extractArticle(html: string, maxChars = 6_000, base = 'https://example.invalid/'): ArticleMaterial {
  const scope = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html
  const paragraphs = [...scope.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)]
    .map((m) => stripHtml(m[0]))
    // Short fragments are usually captions, bylines and cookie notices.
    .filter((p) => p.length >= 60)
  return {
    siteName: meta(html, 'og:site_name'),
    images: extractImages(html, base),
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
    return extractArticle((await res.text()).slice(0, 1_500_000), 6_000, res.url || url)
  } catch {
    return null
  }
}
