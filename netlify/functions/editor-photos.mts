import { admin, authenticateEditor, env } from '../../server/store.ts'
import { rankPhotos, searchPhotos, toCandidate } from '../../server/pipeline/unsplash.ts'

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * An editor's own search for licensed photos. Unsplash's API terms ask for
 * non-automated use, so every photo search here is typed and chosen by a person,
 * and nothing is saved until they pick one. Editors only (verified server-side).
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { message: 'Use POST.' })
  const c = env()
  if (!c.supabaseUrl || !c.serviceKey) return json(503, { message: 'The server is not configured.' })
  if (!c.unsplashKey) return json(503, { message: 'Photo search is not set up. Add UNSPLASH_ACCESS_KEY to the server settings.' })
  const db = admin()
  const auth = await authenticateEditor(db, req.headers.get('authorization'))
  if (!auth.ok) return json(auth.status, { message: auth.message })

  const { query } = (await req.json().catch(() => ({}))) as { query?: string }
  const q = (query ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (q.length < 3) return json(400, { message: 'Type at least a few letters to search.' })
  try {
    const photos = rankPhotos(await searchPhotos(q, c.unsplashKey, 12), q, { aboutPerson: false, minOverlap: 0 }).slice(0, 9)
    return json(200, { photos: photos.map((p) => toCandidate(p, c.appName, q)) })
  } catch (e) {
    return json(502, { message: e instanceof Error ? e.message : 'Photo search failed.' })
  }
}
