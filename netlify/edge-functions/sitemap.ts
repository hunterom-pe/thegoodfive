import { sitemapXml } from '../../src/lib/meta.ts'

/**
 * /sitemap.xml: the pages worth indexing and every published edition, read from the public view (which only
 * holds editions that are published and not in the future). If the database cannot be asked, say so with a 503
 * instead of serving a sitemap that quietly leaves editions out; crawlers retry later.
 */
export default async () => {
  const env = (globalThis as unknown as { Netlify?: { env: { get(k: string): string | undefined } } }).Netlify?.env
  const base = env?.get('VITE_SUPABASE_URL')?.replace(/\/$/, '')
  const key = env?.get('VITE_SUPABASE_ANON_KEY')
  const unavailable = () => new Response('The sitemap is temporarily unavailable.', { status: 503, headers: { 'Retry-After': '600', 'Content-Type': 'text/plain; charset=utf-8' } })
  if (!base || !key) return unavailable()
  try {
    const dates: string[] = []
    // Newest first, in pages, so the sitemap stays complete however long the archive grows.
    for (let from = 0; from < 50_000; from += 1000) {
      const res = await fetch(`${base}/rest/v1/public_editions?select=edition_date&order=edition_date.desc`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return unavailable()
      const rows = (await res.json()) as { edition_date: string }[]
      dates.push(...rows.map((r) => r.edition_date))
      if (rows.length < 1000) break
    }
    return new Response(sitemapXml(dates), { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
  } catch {
    return unavailable()
  }
}

export const config = { path: '/sitemap.xml' }
