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

const STOP = new Set('with from that this have been were will into over after their about more than other which where while there these those they them what when also year years including filled holding showing various several multiple around through standing sitting looking background foreground picture photo image close'.split(' '))
/** Words too common to show a photo fits a story: colours, shapes, and wording that fits anything. */
const WEAK = new Set('light water white black green blue brown field fields view views large small group lots many body under during daytime time night sunny against above below between along near open close wide long high first found study studies researchers research people world global community nature scenery urban neighbourhood yellow red pink orange brown grey gray golden colorful colourful purple power energy clean healthy'.split(' '))
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
/** Seven letters of the singular: astronomers/astronomy, turbine/turbines and telescope/telescopes meet. */
const tokens = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => singular(w).slice(0, 7)))

/**
 * Stories where a stock picture is likelier to jar than to help: a specific person, a child or a patient,
 * war and death. These get a photo only when it is clearly about the story's own subject, never a
 * general "mood" picture; otherwise the geometric artwork is the better choice.
 */
const SENSITIVE = /\b(infant|baby|babies|child|children|kids?|toddler|war|wartime|wwii|world war|holocaust|genocide|died|dies|death|killed|victims?|memorial|funeral|cancer|dementia|alzheimer|seizures?|epilep\w*|disabilit\w*|suicide|abuse|refugees?|hostages?|survivor)\b/i

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
 * How a story and a photo's subject words relate. Subject words an editor chose for the photo (its keywords) count for
 * more than words that merely appear in its caption; common words (colours, "energy", "power") never count as subjects.
 */
export function subjectMatch(story: { headline: string; summary: string }, photo: Pick<LibraryPhoto, 'keywords' | 'alt'>, query = ''): { keyword: number; caption: number; inHeadline: number; weak: number } {
  const headline = tokens(story.headline)
  const wanted = tokens(`${query} ${story.headline} ${story.summary}`)
  const keywords = tokens(photo.keywords.join(' '))
  let keyword = 0
  let caption = 0
  let inHeadline = 0
  let weak = 0
  for (const w of new Set([...keywords, ...tokens(photo.alt)])) {
    if (!wanted.has(w)) continue
    if (WEAK.has(w)) {
      weak++
      continue
    }
    if (keywords.has(w)) keyword++
    else caption++
    if (headline.has(w)) inHeadline++
  }
  return { keyword, caption, inHeadline, weak }
}

/**
 * Choose the library photo that fits a story's subject, or none (the artwork is better than a wrong picture).
 *  - An ordinary story needs one of the photo's subject keywords in its headline, or two matching subject words anywhere.
 *  - A sensitive story, or one about a specific person, needs a subject word in its headline AND two matching words in all.
 *  - Failing that, an ordinary story may get a neutral picture an editor marked generic for the category (a landscape,
 *    a skyline). Sensitive and person stories never do.
 *  - Photos showing people are never used for a story about a specific person.
 * Recently used photos rest unless nothing else fits.
 */
export function pickFromLibrary(story: { category: string; headline: string; summary: string }, library: LibraryPhoto[], ctx: PickContext): LibraryPhoto | null {
  const rest = ctx.restDays ?? 10
  const careful = ctx.aboutPerson || SENSITIVE.test(`${story.headline} ${story.summary}`)
  const eligible = library
    .filter((p) => !ctx.used.has(p.id) && p.categories.includes(story.category) && !(ctx.aboutPerson && p.showsPeople))
    .map((p) => {
      const m = subjectMatch(story, p, ctx.query)
      const strong = m.keyword + m.caption
      const matches = careful ? m.keyword >= 1 && m.inHeadline >= 1 && strong >= 2 : m.keyword >= 1 && (m.inHeadline >= 1 || strong >= 2)
      return { p, score: m.keyword * 3 + m.caption + m.inHeadline * 2 + m.weak, matches, rested: daysSince(p.lastUsedOn, ctx.today) >= rest }
    })
    .filter(({ p, matches }) => matches || (p.generic && !careful))
  // Order, strictly: (1) a photo that fits the story's subject beats any neutral one, even if it was used
  // recently; (2) within the same tier, a rested photo beats a recently used one; (3) then the closer subject
  // match; (4) then the one used longest ago (never used counts as longest). A small library therefore
  // repeats a relevant photo before it falls back to a neutral one.
  const lastUsed = (p: LibraryPhoto) => p.lastUsedOn ?? ''
  eligible.sort((a, b) => Number(b.matches) - Number(a.matches) || Number(b.rested) - Number(a.rested) || b.score - a.score || lastUsed(a.p).localeCompare(lastUsed(b.p)))
  return eligible[0]?.p ?? null
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
