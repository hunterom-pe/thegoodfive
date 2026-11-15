/**
 * Propose licensed photos for an edition, for a person to review. Read-only: it changes nothing.
 *
 *   npm run photos:propose -- --date 2026-11-15 --q 1="wild bees meadow" --q 2="river salmon" ...
 *   (add --person N for a story about a specific person: photos showing people are excluded)
 *
 * A person types the search words, so this is a human-driven Unsplash search (the same thing as the editor's
 * photo search). It writes proposals/<date>-photos.md with thumbnails, credits and links. Nothing is saved to
 * the database, no download notice is sent (that happens only when a photo is actually chosen in the editor),
 * and the live edition is never touched. Needs UNSPLASH_ACCESS_KEY and the public Supabase address/key.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { rankPhotos, searchPhotos, toCandidate, withUtm } from './pipeline/unsplash.ts'
import { editionToday, env } from './store.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.find((_, i) => args[i - 1] === name)
const date = flag('--date') ?? editionToday()
const queries = new Map<number, string>()
const people = new Set<number>()
args.forEach((a, i) => {
  if (args[i - 1] === '--q') {
    const m = /^(\d)=(.+)$/.exec(a)
    if (m) queries.set(Number(m[1]), m[2])
  }
  if (args[i - 1] === '--person') people.add(Number(a))
})

const c = env()
const base = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? ''
if (!base || !anon) throw new Error('Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (public values) in .env.local.')
const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
  if (!res.ok) throw new Error(`Could not read ${path.split('?')[0]} (HTTP ${res.status}).`)
  return (await res.json()) as T
}

const [edition] = await get<{ id: string }[]>(`public_editions?select=id&edition_date=eq.${date}&limit=1`)
if (!edition) throw new Error(`No published edition for ${date}.`)
const stories = await get<{ position: number; category: string; headline: string; summary: string; image_url: string | null }[]>(`public_stories?select=position,category,headline,summary,image_url&edition_id=eq.${edition.id}&order=position`)

if (queries.size === 0) {
  console.log(`Edition ${date}: pass a search for each story, e.g. --q 1="wild bees meadow"\n`)
  for (const s of stories) console.log(`${s.position}. [${s.category}] ${s.headline}${s.image_url ? '  (already has a photo)' : ''}`)
  process.exit(0)
}
if (!c.unsplashKey) throw new Error('Needs UNSPLASH_ACCESS_KEY in .env.local.')

const out: string[] = [`# Photo proposals for ${date}`, '', `Prepared ${new Date().toISOString().slice(0, 10)} for review. **Nothing has been saved or published.** To use one: open the edition in the editor, open the story's “Photograph” panel, search for the same words and choose “Use this photo” (this also tells Unsplash it was used). Choose “Save to library” as well to make it available to future automatic editions.`, '']
for (const s of stories) {
  const q = queries.get(s.position)
  out.push(`## ${s.position}. ${s.headline}`, '', `Category: ${s.category}${people.has(s.position) ? ' · about a specific person: photos showing people excluded' : ''}`, '')
  if (!q) {
    out.push('_No search requested._', '')
    continue
  }
  const found = rankPhotos(await searchPhotos(q, c.unsplashKey, 12), q, { aboutPerson: people.has(s.position), minOverlap: 0 }).slice(0, 3)
  out.push(`Search: “${q}”`, '')
  if (found.length === 0) out.push('_No suitable photo found. The story would keep the geometric artwork._', '')
  found.forEach((p, i) => {
    const cand = toCandidate(p, c.appName, q)
    out.push(
      `**Option ${i + 1}** — ${cand.alt}`,
      '',
      `![${cand.alt}](${cand.url}&w=480&auto=format&fit=crop&q=70)`,
      '',
      `Photo by [${p.user.name}](${withUtm(p.user.links.html, c.appName)}) on [Unsplash](${withUtm('https://unsplash.com/', c.appName)}) · [photo page](${withUtm(p.links.html, c.appName)}) · labelled *Illustrative photo. Representative, not from the reported event.*`,
      '',
    )
  })
}
mkdirSync('proposals', { recursive: true })
const file = `proposals/${date}-photos.md`
writeFileSync(file, out.join('\n'))
console.log(`Wrote ${file}`)
