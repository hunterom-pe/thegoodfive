import { XMLParser } from 'fast-xml-parser'
import type { Feed } from './feeds.ts'
import { stripTracking } from './dedupe.ts'
import { decodeEntities, stripHtml, truncate } from './text.ts'
import type { Candidate } from './types.ts'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: false })

const list = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value])
const text = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node && typeof node === 'object' && '#text' in node) return String((node as { '#text': unknown })['#text'])
  return ''
}
const toISO = (value: string): string | null => {
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/** Atom links come as one or many <link href rel>; prefer the article itself. */
function atomLink(link: unknown): string {
  const links = list(link as Record<string, string> | Record<string, string>[])
  const best = links.find((l) => typeof l === 'object' && (l['@_rel'] ?? 'alternate') === 'alternate') ?? links[0]
  return typeof best === 'string' ? best : (best?.['@_href'] ?? '')
}

/** Parse RSS 2.0 or Atom into candidates. Items without a title or an http link are dropped. */
export function parseFeed(xml: string, feed: Feed): Candidate[] {
  const doc = parser.parse(xml) as Record<string, any>
  const rssItems = list(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item)
  const atomEntries = list(doc.feed?.entry)

  const raw = [
    ...rssItems.map((item: Record<string, unknown>) => ({
      title: text(item.title),
      url: text(item.link) || text(item.guid),
      date: text(item.pubDate) || text(item['dc:date']),
      body: text(item.description) || text(item['content:encoded']),
    })),
    ...atomEntries.map((entry: Record<string, unknown>) => ({
      title: text(entry.title),
      url: atomLink(entry.link),
      date: text(entry.published) || text(entry.updated),
      body: text(entry.summary) || text(entry.content),
    })),
  ]

  return raw
    .map((item) => ({ ...item, title: stripHtml(item.title), url: stripTracking(decodeEntities(item.url)) }))
    .filter((item) => item.title && /^https?:\/\//i.test(item.url))
    .map((item) => ({
      id: '',
      title: item.title,
      url: item.url,
      sourceName: feed.name.replace(/\s*\(.*\)$/, ''),
      publishedAt: toISO(item.date),
      excerpt: truncate(stripHtml(item.body), 600),
      via: `RSS: ${feed.name}`,
      trust: feed.trust,
    }))
}

export const USER_AGENT = 'TheGoodFiveBot/1.0 (daily news digest; links to original reporting)'

export async function fetchFeed(feed: Feed, timeoutMs = 10_000): Promise<Candidate[]> {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`)
  return parseFeed(await res.text(), feed)
}
