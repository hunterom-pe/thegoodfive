import { applyMeta, metaForPath, statusForPath, type EditionFacts } from '../../src/lib/meta.ts'

/**
 * Writes each page's own title, description, canonical address and sharing tags into the HTML before it
 * is sent, so crawlers that don't run JavaScript see the right ones. Everything else passes through
 * untouched, and any failure falls back to the plain page: a problem here can never take the site down.
 */
export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const response = await context.next()
  try {
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response
    const url = new URL(request.url)
    // The editor and the raw index file have their own headers and no public metadata.
    if (/^\/(editor(\/|$)|index\.html$)/.test(url.pathname)) return response
    let facts: EditionFacts | null = null
    const m = /^\/edition\/(\d{4}-\d{2}-\d{2})\/?$/.exec(url.pathname)
    if (m) facts = await lookup(m[1])
    const html = applyMeta(await response.text(), metaForPath(url.pathname, facts))
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    // The site's catch-all answers 200 for everything; say 404 for pages that do not exist (and keep any other status).
    const status = response.status === 200 ? statusForPath(url.pathname, facts) : response.status
    return new Response(html, { status, headers })
  } catch {
    return response
  }
}

/** The published headlines for a date, from the public read-only view. Null if it can't be asked. */
async function lookup(date: string): Promise<EditionFacts | null> {
  // Deno is the edge runtime; read through its global without needing its type definitions here.
  const env = (globalThis as unknown as { Netlify?: { env: { get(k: string): string | undefined } } }).Netlify?.env
  const base = env?.get('VITE_SUPABASE_URL')?.replace(/\/$/, '')
  const key = env?.get('VITE_SUPABASE_ANON_KEY')
  if (!base || !key) return null
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    const eds = await fetch(`${base}/rest/v1/public_editions?select=id&edition_date=eq.${date}&limit=1`, { headers, signal: AbortSignal.timeout(2500) })
    if (!eds.ok) return null
    const [edition] = (await eds.json()) as { id: string }[]
    if (!edition) return { date, exists: false }
    const st = await fetch(`${base}/rest/v1/public_stories?select=headline,position&edition_id=eq.${edition.id}&order=position`, { headers, signal: AbortSignal.timeout(2500) })
    const rows = st.ok ? ((await st.json()) as { headline: string }[]) : []
    return { date, exists: true, headlines: rows.map((r) => r.headline) }
  } catch {
    return null
  }
}

// Every path, so that made-up addresses get their 404 too; static files and the sitemap are left out.
export const config = {
  path: '/*',
  excludedPath: ['/assets/*', '/.netlify/*', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest', '/favicon*', '/apple-touch-icon.png', '/icon-*', '/og-image.png', '/logo.svg'],
}
