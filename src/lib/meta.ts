/**
 * Per-route page metadata, shared by the site (so the tags stay right as a reader navigates) and by the
 * edge function that writes them into the HTML itself, so search engines and social crawlers, which
 * mostly do not run scripts, see the right title, description and canonical address on every page.
 * No imports: the edge runtime must be able to load this file on its own.
 */
export const SITE = 'https://thegoodfive.netlify.app'
export const DEFAULT_TITLE = 'The Good Five — Five good things. Every day.'
export const DEFAULT_DESCRIPTION = 'A daily edition of exactly five good news stories from around the world. Five good things. Every day. That\'s it.'

export interface PageMeta {
  title: string
  description: string
  /** Absolute, self-referencing address. */
  canonical: string
  /** Used for Open Graph / Twitter, which read better without the site suffix. */
  shareTitle: string
  /** Set for pages that should not be indexed (editor, unknown routes, dates with no edition). */
  noindex: boolean
}

const isRealDate = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const d = new Date(0)
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

const longDate = (date: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`)).replace(',', '')

/** At most `max` characters, cut at a word boundary. */
const clip = (text: string, max: number) => {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,;:.-]+$/, '')}…`
}

export interface EditionFacts {
  date: string
  /** The five headlines in order. Empty or absent when they are not known (the generic description is used). */
  headlines?: string[]
  /** False when the database was asked and there is no published edition for the date. */
  exists?: boolean
}

export function metaForPath(pathname: string, edition?: EditionFacts | null): PageMeta {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { title: DEFAULT_TITLE, shareTitle: 'The Good Five: five good things, every day', description: DEFAULT_DESCRIPTION, canonical: `${SITE}/`, noindex: false }
  if (path === '/about')
    return {
      title: 'About — The Good Five',
      shareTitle: 'About The Good Five',
      description: 'How The Good Five works: AI-assisted discovery, automated source and claim checks, and human correction. Every story links to the original reporting.',
      canonical: `${SITE}/about`,
      noindex: false,
    }
  if (path === '/archive')
    return {
      title: 'Archive — The Good Five',
      shareTitle: 'The Good Five archive',
      description: 'Every past edition of The Good Five, newest first. Five good news stories a day, kept exactly as they ran.',
      canonical: `${SITE}/archive`,
      noindex: false,
    }
  const m = /^\/edition\/([^/]+)$/.exec(path)
  if (m) {
    const date = m[1]
    if (!isRealDate(date)) return { title: 'Edition not found — The Good Five', shareTitle: 'Edition not found', description: DEFAULT_DESCRIPTION, canonical: `${SITE}/`, noindex: true }
    const when = longDate(date)
    const missing = edition?.date === date && edition.exists === false
    const heads = edition?.date === date ? (edition.headlines ?? []).filter(Boolean) : []
    return {
      title: `${when} — The Good Five`,
      shareTitle: `The Good Five: ${when}`,
      description: heads.length ? clip(`Five good news stories for ${when}: ${heads.join('; ')}.`, 158) : `The five good news stories from ${when}, each linking to the original reporting.`,
      canonical: `${SITE}/edition/${date}`,
      noindex: missing,
    }
  }
  return { title: 'Page not found — The Good Five', shareTitle: 'Page not found', description: DEFAULT_DESCRIPTION, canonical: `${SITE}/`, noindex: true }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Write a route's metadata into the site's HTML. Tags it cannot find are left alone.
 * Every replacement is a function, never a replacement string: in a string, "$1", "$&" or "$'" inside a
 * headline ("raises $1 million") would be read as replacement syntax and corrupt the page.
 */
export function applyMeta(html: string, m: PageMeta): string {
  const attr = (re: RegExp, value: string) => {
    html = html.replace(re, (_match, before: string, after: string) => before + esc(value) + after)
  }
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(m.title)}</title>`)
  attr(/(<meta\s+name="description"\s+content=")[^"]*(")/, m.description)
  attr(/(<link rel="canonical" href=")[^"]*(")/, m.canonical)
  attr(/(<meta property="og:url" content=")[^"]*(")/, m.canonical)
  attr(/(<meta property="og:title" content=")[^"]*(")/, m.shareTitle)
  attr(/(<meta property="og:description" content=")[^"]*(")/, m.description)
  attr(/(<meta name="twitter:title" content=")[^"]*(")/, m.shareTitle)
  attr(/(<meta name="twitter:description" content=")[^"]*(")/, m.description)
  if (m.noindex && !/name="robots"/.test(html)) html = html.replace(/<\/head>/, () => '    <meta name="robots" content="noindex, follow" />\n  </head>')
  return html
}
