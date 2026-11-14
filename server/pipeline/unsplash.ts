import type { StoredImageCandidate } from './types.ts'

/**
 * Licensed photography from Unsplash, used the way its API guidelines require
 * (checked November 2026, help.unsplash.com/api-guidelines):
 *   - hotlink the URLs the API returns, keeping their `ixid` parameter;
 *   - credit the photographer AND Unsplash, with links tagged
 *     ?utm_source=<app>&utm_medium=referral;
 *   - call the photo's download endpoint when a photo is chosen;
 *   - keep the access key on the server.
 */
export interface UnsplashPhoto {
  id: string
  width: number
  height: number
  alt_description: string | null
  description: string | null
  urls: { raw: string; regular: string }
  links: { html: string; download_location?: string }
  user: { name: string; links: { html: string } }
}

const API = 'https://api.unsplash.com'
const headers = (key: string) => ({ Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' })

export const withUtm = (url: string, app: string): string => {
  const u = new URL(url)
  u.searchParams.set('utm_source', app)
  u.searchParams.set('utm_medium', 'referral')
  return u.toString()
}

export async function searchPhotos(query: string, key: string, perPage = 12): Promise<UnsplashPhoto[]> {
  const url = `${API}/search/photos?${new URLSearchParams({ query, orientation: 'landscape', content_filter: 'high', per_page: String(perPage) })}`
  const res = await fetch(url, { headers: headers(key), signal: AbortSignal.timeout(15_000) })
  if (res.status === 401 || res.status === 403) throw new Error('Unsplash rejected the access key (or the hourly limit is used up).')
  if (!res.ok) throw new Error(`Unsplash search failed (HTTP ${res.status}).`)
  const body = (await res.json()) as { results?: UnsplashPhoto[] }
  return (body.results ?? []).filter((p) => p?.urls?.raw && p.user?.links?.html && p.links?.html)
}

const PEOPLE = /\b(man|men|woman|women|person|people|portrait|boy|girl|child|children|kid|kids|baby|face|faces|selfie|smiling|couple|family|student|students|crowd)\b/i
const PORTRAIT = /\b(portrait|selfie|face|faces|close-up of a (man|woman|person))\b/i
const TEXTY = /\b(text|sign|signage|poster|logo|quote|typography|lettering|letters|banner|billboard|screenshot)\b/i

const tokens = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2))

/**
 * Choose the photo that best shows the story's subject. Photos that could pass
 * for a portrait of the person in the story, or that are mostly text, are
 * never chosen; and when the story is about a specific person, any photo
 * showing people is excluded.
 */
export function rankPhotos(photos: UnsplashPhoto[], query: string, options: { aboutPerson: boolean; exclude?: Set<string> }): UnsplashPhoto[] {
  const wanted = tokens(query)
  return photos
    .filter((p) => !options.exclude?.has(p.id))
    .map((p) => ({ p, words: `${p.alt_description ?? ''} ${p.description ?? ''}` }))
    .filter(({ words }) => !PORTRAIT.test(words) && !TEXTY.test(words) && !(options.aboutPerson && PEOPLE.test(words)))
    .map(({ p, words }) => {
      const have = tokens(words)
      let overlap = 0
      for (const w of wanted) if (have.has(w)) overlap++
      const wide = p.width >= 3000 ? 1 : 0
      return { p, overlap, score: overlap * 3 + wide + (p.alt_description ? 1 : 0) }
    })
    // A photo must share at least one word with what the story is about. A merely
    // "related" result (a computer for a medical story) is worse than the artwork.
    .filter(({ overlap }) => overlap >= 1)
    .sort((a, b) => b.score - a.score)
    .map(({ p }) => p)
}

export function toCandidate(photo: UnsplashPhoto, app: string, query: string): StoredImageCandidate {
  return {
    url: photo.urls.raw, // hotlinked as returned; sized at display time with w/q/fit, ixid kept
    alt: photo.alt_description ?? `Illustrative photo: ${query}`,
    kind: 'illustrative',
    source: 'unsplash',
    credit: photo.user.name,
    creditUrl: withUtm(photo.user.links.html, app),
    license: 'Unsplash License',
    sourceUrl: withUtm(photo.links.html, app),
    downloadLocation: photo.links.download_location ?? null,
  }
}

/** Tell Unsplash a photo was chosen (required by its guidelines). Best effort: never blocks or fails the run. */
export async function triggerDownload(downloadLocation: string | null | undefined, key: string): Promise<boolean> {
  if (!downloadLocation || !/^https:\/\/api\.unsplash\.com\//.test(downloadLocation)) return false
  try {
    const res = await fetch(downloadLocation, { headers: headers(key), signal: AbortSignal.timeout(10_000) })
    return res.ok
  } catch {
    return false
  }
}
