import type { StoredImageCandidate } from './types.ts'

/**
 * A photo an editor chose and saved for reuse. Scheduled editions pick from these, so no
 * search of the photo provider is run by software. See supabase/migrations/20261116000000_photo_library.sql.
 */
export interface LibraryPhoto {
  id: string
  unsplashId: string
  url: string
  alt: string
  credit: string
  creditUrl: string
  sourceUrl: string
  downloadLocation: string | null
  categories: string[]
  keywords: string[]
  generic: boolean
  showsPeople: boolean
  lastUsedOn: string | null
}

const STOP = new Set('with from that this have been were will into over after their about more than other which where while there these those they them what when also year years'.split(' '))
const tokens = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))

/** Days between two ISO dates (or Infinity if never used). */
const daysSince = (date: string | null, today: string) => (date ? (Date.parse(today) - Date.parse(date)) / 86_400_000 : Infinity)

export interface PickContext {
  today: string
  /** Photos already given to another story in this edition. */
  used: Set<string>
  aboutPerson: boolean
  /** The writer's own description of a suitable picture, if any. */
  query?: string
  /** Do not reuse a photo within this many days (default 10). */
  restDays?: number
}

/**
 * Choose the library photo that best fits a story, or none. A photo must either share subject words
 * with the story (the editor's keywords, or its description) or be marked as a good all-round picture
 * for the story's category. Photos showing people are never used for a story about a specific person.
 * A recently used photo rests, so a daily publication doesn't repeat itself, unless nothing else fits.
 */
export function pickFromLibrary(story: { category: string; headline: string; summary: string }, library: LibraryPhoto[], ctx: PickContext): LibraryPhoto | null {
  const wanted = tokens(`${ctx.query ?? ''} ${ctx.query ?? ''} ${story.headline} ${story.summary}`)
  const rest = ctx.restDays ?? 10
  const eligible = library
    .filter((p) => !ctx.used.has(p.id) && p.categories.includes(story.category) && !(ctx.aboutPerson && p.showsPeople))
    .map((p) => {
      const have = tokens(`${p.keywords.join(' ')} ${p.alt}`)
      let overlap = 0
      for (const w of wanted) if (have.has(w)) overlap++
      // Keywords an editor chose count more than words in a caption.
      const keyword = p.keywords.reduce((n, k) => n + (tokens(k).size && [...tokens(k)].every((w) => wanted.has(w)) ? 1 : 0), 0)
      return { p, score: overlap + keyword * 2, rested: daysSince(p.lastUsedOn, ctx.today) >= rest }
    })
    // A photo must fit the story's subject, or be an all-round picture for its category.
    .filter(({ p, score }) => score >= 1 || p.generic)
  // Prefer photos that have rested; when the library is small and all have been used lately, reuse the one
  // used longest ago, because an unusual repeat is better than no photo. Then the best subject match.
  const pool = eligible.some((e) => e.rested) ? eligible.filter((e) => e.rested) : eligible
  pool.sort((a, b) => b.score - a.score || (a.p.lastUsedOn ?? '').localeCompare(b.p.lastUsedOn ?? ''))
  return pool[0]?.p ?? null
}

/** The stored candidate for a library photo, labelled illustrative like every other stock photo. */
export function libraryCandidate(p: LibraryPhoto, appName: string): StoredImageCandidate {
  const tagged = (url: string) => {
    const u = new URL(url)
    u.searchParams.set('utm_source', appName)
    u.searchParams.set('utm_medium', 'referral')
    return u.toString()
  }
  return {
    url: p.url,
    alt: p.alt,
    kind: 'illustrative',
    source: 'unsplash',
    credit: p.credit,
    creditUrl: tagged(p.creditUrl),
    license: 'Unsplash License',
    sourceUrl: tagged(p.sourceUrl),
    ...(p.downloadLocation ? { downloadLocation: p.downloadLocation } : {}),
  }
}
