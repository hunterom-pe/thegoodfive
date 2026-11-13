import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/config'
import { todayISO } from '../lib/dates'
import type { Category, EditionSummary, EditorEdition, PublicEdition, PublicStory } from '../lib/types'
import { demoStore } from './demoStore'

/**
 * Everything the public site reads. Readers only ever receive published
 * editions dated today or earlier; the database views enforce "published",
 * and nothing here calls a news or AI service.
 */
export interface PublicRepo {
  latest(): Promise<PublicEdition | null>
  byDate(date: string): Promise<PublicEdition | null>
  archive(): Promise<EditionSummary[]>
}

// ── Demo ────────────────────────────────────────────────────────────────

function toPublic(edition: EditorEdition): PublicEdition {
  return {
    id: edition.id,
    date: edition.date,
    publishedAt: edition.publishedAt,
    isDemo: edition.isDemo,
    stories: edition.stories
      .filter((s) => s.role === 'primary' && s.position !== null)
      .sort((a, b) => a.position! - b.position!)
      .map((s) => ({
        id: s.id,
        position: s.position!,
        category: s.category,
        headline: s.headline,
        summary: s.summary,
        sourceName: s.sourceName,
        sourceUrl: s.sourceUrl,
        sourcePublishedAt: s.sourcePublishedAt,
        imageUrl: s.imageRightsConfirmed ? s.imageUrl : null,
        imageAlt: s.imageRightsConfirmed ? s.imageAlt : null,
        imageCredit: s.imageRightsConfirmed ? s.imageCredit : null,
      })),
  }
}

/** Used by the editor preview as well, so a preview is exactly what readers will get. */
export const editionAsPublic = toPublic

const demoPublished = () =>
  demoStore
    .editions()
    .filter((e) => e.status === 'published' && e.date <= todayISO())
    .sort((a, b) => b.date.localeCompare(a.date))

const demoRepo: PublicRepo = {
  async latest() {
    const [first] = demoPublished()
    return first ? toPublic(first) : null
  },
  async byDate(date) {
    const found = demoPublished().find((e) => e.date === date)
    return found ? toPublic(found) : null
  },
  async archive() {
    return demoPublished().map((e) => {
      const { id, date, isDemo, stories } = toPublic(e)
      return { id, date, isDemo, stories: stories.map(({ position, category, headline }) => ({ position, category, headline })) }
    })
  },
}

// ── Supabase (plain REST, so readers never download the auth client) ─────

interface EditionRow {
  id: string
  edition_date: string
  published_at: string | null
}
interface StoryRow {
  id: string
  edition_id: string
  position: number
  category: Category
  headline: string
  summary: string
  source_name: string
  source_url: string
  source_published_at: string | null
  image_url: string | null
  image_alt: string | null
  image_credit: string | null
}

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  })
  if (!res.ok) throw new Error(`Could not load the edition (${res.status})`)
  return res.json() as Promise<T>
}

const storyFromRow = (r: StoryRow): PublicStory => ({
  id: r.id,
  position: r.position,
  category: r.category,
  headline: r.headline,
  summary: r.summary,
  sourceName: r.source_name,
  sourceUrl: r.source_url,
  sourcePublishedAt: r.source_published_at,
  imageUrl: r.image_url,
  imageAlt: r.image_alt,
  imageCredit: r.image_credit,
})

async function loadEdition(filter: string): Promise<PublicEdition | null> {
  const [edition] = await rest<EditionRow[]>(
    `public_editions?select=id,edition_date,published_at&${filter}&edition_date=lte.${todayISO()}&order=edition_date.desc&limit=1`,
  )
  if (!edition) return null
  const stories = await rest<StoryRow[]>(`public_stories?select=*&edition_id=eq.${edition.id}&order=position.asc`)
  return {
    id: edition.id,
    date: edition.edition_date,
    publishedAt: edition.published_at,
    isDemo: false,
    stories: stories.map(storyFromRow),
  }
}

const supabaseRepo: PublicRepo = {
  latest: () => loadEdition('id=not.is.null'),
  byDate: (date) => loadEdition(`edition_date=eq.${date}`),
  async archive() {
    const editions = await rest<EditionRow[]>(
      `public_editions?select=id,edition_date&edition_date=lte.${todayISO()}&order=edition_date.desc&limit=120`,
    )
    if (editions.length === 0) return []
    const stories = await rest<Pick<StoryRow, 'edition_id' | 'position' | 'category' | 'headline'>[]>(
      `public_stories?select=edition_id,position,category,headline&edition_id=in.(${editions.map((e) => e.id).join(',')})&order=position.asc`,
    )
    return editions.map((e) => ({
      id: e.id,
      date: e.edition_date,
      isDemo: false,
      stories: stories.filter((s) => s.edition_id === e.id),
    }))
  },
}

export const publicRepo: PublicRepo = IS_DEMO ? demoRepo : supabaseRepo
