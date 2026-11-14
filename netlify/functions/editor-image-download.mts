import { admin, authenticateEditor, env } from '../../server/store.ts'
import { triggerDownload } from '../../server/pipeline/unsplash.ts'

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Unsplash's API guidelines ask to be told when a photo is chosen. The editor's
 * browser must not hold the access key, so it asks us. Only a signed-in editor
 * can call this, and only for a photo that is genuinely the story's selected
 * Unsplash image (the stored download address is used, never one sent by the caller).
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { message: 'Use POST.' })
  const c = env()
  if (!c.supabaseUrl || !c.serviceKey || !c.unsplashKey) return json(503, { message: 'Photo tracking is not configured.' })

  const db = admin()
  const auth = await authenticateEditor(db, req.headers.get('authorization'))
  if (!auth.ok) return json(auth.status, { message: auth.message })

  const { storyId } = (await req.json().catch(() => ({}))) as { storyId?: string }
  if (!storyId || !/^[0-9a-f-]{36}$/i.test(storyId)) return json(400, { message: 'Missing story.' })

  const { data: story } = await db.from('stories').select('image_url, image_source, image_candidates').eq('id', storyId).maybeSingle()
  if (!story || story.image_source !== 'unsplash') return new Response(null, { status: 204 })
  const match = (story.image_candidates as { url?: string; downloadLocation?: string }[] | null)?.find((x) => x.url === story.image_url)
  const ok = await triggerDownload(match?.downloadLocation, c.unsplashKey)
  return json(ok ? 200 : 202, { notified: ok })
}
