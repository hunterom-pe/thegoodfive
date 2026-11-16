import { demoStore } from '../data/demoStore'
import { IS_DEMO } from '../lib/config'
import type { Category, EditionStatus, EditorEdition, EditorEditionSummary, EditorStory, ImageCandidate, ImageKind, NewStory, StoryPatch, StoryRole } from '../lib/types'
import type { Lineup } from './lineup'
import { supabase } from './supabaseClient'

/**
 * Everything the editor can do. The Supabase implementation is thin on
 * purpose: the database decides what is allowed (see the migration), and
 * this file only asks.
 */
/** Whether the AI key stored on the SERVER works. Shape and a one-way fingerprint only: never the key. */
export interface AiStatus {
  provider: string
  /** The host the server sends AI requests to. */
  host: string
  model: string
  keySource: string
  keyLength: number
  keyPrefix: string
  fingerprint: string
  /** true = the provider accepts it, false = it rejects it, null = could not be checked. */
  accepted: boolean | null
  cause: string
}

/** What the dashboard shows about the automatic workflow. */
export interface AutomationSnapshot {
  /** From the server. Null when the server can't be asked (demo mode, or the function isn't reachable). */
  config: { autoPublishEnabled: boolean; alertsConfigured: boolean; unsplashConfigured: boolean; ai: AiStatus | null } | null
  lastPublished: { date: string; publishedAt: string; automatic: boolean } | null
  generation: { status: string; error: string | null; startedAt: string; trigger: string } | null
  publication: { status: string; reason: string | null; startedAt: string; trigger: string; accepted: number; rejected: { headline: string; reasons: string[] }[] } | null
  today: { status: string; primary: number; backup: number; withoutPhoto: number; rejected: { headline: string; reason: string }[] } | null
  /** Photos saved for scheduled editions to choose from. Null if the library can't be read (migration not run). */
  libraryCount: number | null
}

export interface PublishCheckReport {
  status: string
  reason: string
  details: { accepted?: { headline: string; source: string }[]; rejected?: { headline: string; source: string; reasons: string[] }[]; warnings?: string[] }
}

export interface GenerateOutcome {
  status: 'succeeded' | 'skipped' | 'failed'
  message: string
  /** Where to review the new draft, when one was created. */
  editionId?: string
}

export interface EditorRepo {
  list(): Promise<EditorEditionSummary[]>
  get(id: string): Promise<EditorEdition | null>
  updateStory(editionId: string, storyId: string, patch: StoryPatch): Promise<void>
  setLineup(editionId: string, lineup: Lineup, rejection?: { id: string; reason: string }): Promise<void>
  setStatus(editionId: string, status: EditionStatus): Promise<void>
  /** Start an empty draft for a date. Resolves with the new edition's id. */
  createEdition(date: string): Promise<string>
  addStory(editionId: string, story: NewStory): Promise<void>
  /** Ask the server to find, screen and write today's draft. Resolves when the run finishes. */
  generate(): Promise<GenerateOutcome>
  /** Everything the Automation panel shows. */
  automation(today: string): Promise<AutomationSnapshot>
  /** Verify today's draft against every publication rule and report. Publishes nothing. */
  checkPublish(): Promise<PublishCheckReport>
  /** Change ONLY the image of a story, even on a published edition. The words stay locked. */
  updateStoryImage(editionId: string, story: EditorStory, patch: StoryPatch): Promise<void>
  /** An editor's own search for licensed photos (Unsplash asks for human-driven use). */
  searchPhotos(query: string): Promise<ImageCandidate[]>
  /** Save an Unsplash photo an editor chose to the library that scheduled editions pick from. */
  saveToLibrary(photo: ImageCandidate, category: string, keywords: string): Promise<void>
  /** Tell the photo provider (Unsplash requires this) that an editor chose a photo. Best effort. */
  trackImageUse(storyId: string): Promise<void>
  /** Permanently remove a story that has already been rejected. */
  deleteStory(editionId: string, storyId: string): Promise<void>
}

// ── Demo ────────────────────────────────────────────────────────────────

const demoRepo: EditorRepo = {
  async list() {
    return demoStore
      .editions()
      .map((e) => ({
        id: e.id,
        date: e.date,
        status: e.status,
        primaryCount: e.stories.filter((s) => s.role === 'primary').length,
        backupCount: e.stories.filter((s) => s.role === 'backup').length,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  },
  async get(id) {
    return demoStore.edition(id)
  },
  async updateStory(editionId, storyId, patch) {
    demoStore.updateStory(editionId, storyId, patch)
  },
  async setLineup(editionId, lineup, rejection) {
    const edition = demoStore.edition(editionId)
    if (edition?.status === 'published') throw new Error('This edition is published. Unpublish it before changing the lineup.')
    demoStore.setLineup(editionId, lineup.primary, lineup.backup, rejection)
  },
  async setStatus(editionId, status) {
    const edition = demoStore.edition(editionId)
    if (status === 'published' && edition?.stories.filter((s) => s.role === 'primary').length !== 5) {
      throw new Error('An edition needs exactly five stories before it can be published.')
    }
    demoStore.setStatus(editionId, status)
  },
  async createEdition(date) {
    return demoStore.createEdition(date)
  },
  async addStory(editionId, story) {
    demoStore.addStory(editionId, story)
  },
  async deleteStory(editionId, storyId) {
    demoStore.deleteStory(editionId, storyId)
  },
  async trackImageUse() {},
  async automation() {
    const edition = demoStore.editions().find((e) => e.status === 'draft')
    return {
      config: null,
      lastPublished: (() => {
        const p = demoStore.editions().filter((e) => e.status === 'published').sort((a, b) => b.date.localeCompare(a.date))[0]
        return p ? { date: p.date, publishedAt: p.publishedAt ?? p.date, automatic: false } : null
      })(),
      generation: null,
      publication: null,
      today: edition ? { status: edition.status, primary: edition.stories.filter((s) => s.role === 'primary').length, backup: edition.stories.filter((s) => s.role === 'backup').length, withoutPhoto: edition.stories.filter((s) => s.role === 'primary' && !(s.imageUrl && s.imageRightsConfirmed)).length, rejected: [] } : null,
      libraryCount: 0,
    }
  },
  async checkPublish() {
    throw new Error('Publish checks need Supabase and the Netlify functions. They are not available in demo mode.')
  },
  async updateStoryImage(editionId, story, patch) {
    demoStore.updateImage(editionId, story.id, patch)
  },
  async searchPhotos(query) {
    if (!query.trim()) return []
    return [
      { url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=72', alt: 'A sunlit path through tall woodland', kind: 'illustrative', source: 'unsplash', credit: 'Sample photographer', creditUrl: 'https://unsplash.com/', license: 'Unsplash License', sourceUrl: 'https://unsplash.com/' },
      { url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1200&q=72', alt: 'Mountains above a misty valley', kind: 'illustrative', source: 'unsplash', credit: 'Sample photographer', creditUrl: 'https://unsplash.com/', license: 'Unsplash License', sourceUrl: 'https://unsplash.com/' },
    ]
  },
  async saveToLibrary() {
    throw new Error('The photo library needs Supabase. It isn’t available in demo mode.')
  },
  async generate() {
    throw new Error('Generating a draft needs Supabase and the Netlify functions. It isn’t available in demo mode.')
  },
}

// ── Supabase ────────────────────────────────────────────────────────────

interface StoryRow {
  id: string
  edition_id: string
  role: StoryRole
  position: number | null
  rejected_reason: string | null
  category: Category
  headline: string
  summary: string
  source_name: string
  source_url: string
  source_published_at: string | null
  source_published_on?: string | null
  image_url: string | null
  image_alt: string | null
  image_credit: string | null
  image_license: string | null
  image_rights_confirmed: boolean
  image_kind: ImageKind | null
  image_source: string | null
  image_source_url: string | null
  image_credit_url: string | null
  image_candidates: unknown
  image_editor_approved: boolean
  original_title: string | null
  original_excerpt: string | null
  discovered_via: string | null
  ai_rationale: string | null
  claims_to_check: unknown
}

const fromRow = (r: StoryRow): EditorStory => ({
  id: r.id,
  editionId: r.edition_id,
  role: r.role,
  position: r.position,
  rejectedReason: r.rejected_reason,
  category: r.category,
  headline: r.headline,
  summary: r.summary,
  sourceName: r.source_name,
  sourceUrl: r.source_url,
  sourcePublishedAt: r.source_published_at,
  sourcePublishedOn: r.source_published_on ?? null,
  imageUrl: r.image_url,
  imageAlt: r.image_alt,
  imageCredit: r.image_credit,
  imageLicense: r.image_license,
  imageRightsConfirmed: r.image_rights_confirmed,
  imageKind: r.image_kind ?? null,
  imageSource: r.image_source ?? null,
  imageSourceUrl: r.image_source_url ?? null,
  imageCreditUrl: r.image_credit_url ?? null,
  imageCandidates: Array.isArray(r.image_candidates) ? (r.image_candidates as ImageCandidate[]) : [],
  imageEditorApproved: r.image_editor_approved ?? false,
  originalTitle: r.original_title,
  originalExcerpt: r.original_excerpt,
  discoveredVia: r.discovered_via,
  aiRationale: r.ai_rationale,
  claimsToCheck: Array.isArray(r.claims_to_check) ? r.claims_to_check.map(String) : [],
})

const COLUMN: Record<keyof StoryPatch, string> = {
  category: 'category',
  headline: 'headline',
  summary: 'summary',
  sourceName: 'source_name',
  sourceUrl: 'source_url',
  sourcePublishedAt: 'source_published_at',
  imageUrl: 'image_url',
  imageAlt: 'image_alt',
  imageCredit: 'image_credit',
  imageLicense: 'image_license',
  imageRightsConfirmed: 'image_rights_confirmed',
  imageKind: 'image_kind',
  imageSource: 'image_source',
  imageSourceUrl: 'image_source_url',
  imageCreditUrl: 'image_credit_url',
  imageCandidates: 'image_candidates',
  imageEditorApproved: 'image_editor_approved',
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

const supabaseRepo: EditorRepo = {
  async list() {
    const { data, error } = await supabase!.from('editions').select('id, edition_date, status, stories(role)').order('edition_date', { ascending: false }).limit(60)
    check(error)
    return (data ?? []).map((e) => ({
      id: e.id as string,
      date: e.edition_date as string,
      status: e.status as EditionStatus,
      primaryCount: (e.stories as { role: StoryRole }[]).filter((s) => s.role === 'primary').length,
      backupCount: (e.stories as { role: StoryRole }[]).filter((s) => s.role === 'backup').length,
    }))
  },
  async get(id) {
    const { data, error } = await supabase!.from('editions').select('id, edition_date, status, published_at, stories(*)').eq('id', id).maybeSingle()
    check(error)
    if (!data) return null
    return {
      id: data.id,
      date: data.edition_date,
      status: data.status,
      publishedAt: data.published_at,
      isDemo: false,
      stories: (data.stories as StoryRow[]).map(fromRow),
    }
  },
  async updateStory(_editionId, storyId, patch) {
    const row: Record<string, unknown> = Object.fromEntries(Object.entries(patch).map(([k, v]) => [COLUMN[k as keyof StoryPatch], v === '' ? null : v]))
    // An editor's own date replaces the publisher's printed day, so a stale printed day can never outlive it.
    if ('sourcePublishedAt' in patch) row.source_published_on = patch.sourcePublishedAt ? patch.sourcePublishedAt.slice(0, 10) : null
    const { error } = await supabase!.from('stories').update(row).eq('id', storyId)
    check(error)
  },
  async setLineup(editionId, lineup, rejection) {
    const { error } = await supabase!.rpc('set_lineup', {
      p_edition: editionId,
      p_primary: lineup.primary,
      p_backup: lineup.backup,
      p_rejected_id: rejection?.id ?? null,
      p_rejected_reason: rejection?.reason ?? null,
    })
    check(error)
  },
  async setStatus(editionId, status) {
    const { error } = await supabase!.rpc('set_edition_status', { p_edition: editionId, p_status: status })
    check(error)
  },
  async createEdition(date) {
    const { data, error } = await supabase!.rpc('create_edition', { p_date: date })
    check(error)
    return data as string
  },
  async addStory(editionId, s) {
    const { error } = await supabase!.rpc('add_story', {
      p_edition: editionId,
      p_role: s.role,
      p_category: s.category,
      p_headline: s.headline,
      p_summary: s.summary,
      p_source_name: s.sourceName,
      p_source_url: s.sourceUrl,
      p_source_published_at: s.sourcePublishedAt,
      p_image_url: s.imageUrl,
      p_image_alt: s.imageAlt,
      p_image_credit: s.imageCredit,
      p_image_license: s.imageLicense,
      p_image_rights_confirmed: s.imageRightsConfirmed,
    })
    check(error)
  },
  async deleteStory(_editionId, storyId) {
    const { error } = await supabase!.rpc('delete_story', { p_story: storyId })
    check(error)
  },
  async updateStoryImage(_editionId, story, patch) {
    const merged = { ...story, ...patch }
    const { error } = await supabase!.rpc('set_story_image', {
      p_story: story.id,
      p_image: {
        image_url: merged.imageUrl, image_alt: merged.imageAlt, image_credit: merged.imageCredit, image_credit_url: merged.imageCreditUrl,
        image_license: merged.imageLicense, image_kind: merged.imageKind, image_source: merged.imageSource, image_source_url: merged.imageSourceUrl,
        image_candidates: merged.imageCandidates, image_rights_confirmed: merged.imageRightsConfirmed, image_editor_approved: merged.imageEditorApproved,
      },
    })
    check(error)
  },
  async searchPhotos(query) {
    const { data: session } = await supabase!.auth.getSession()
    let res: Response
    try {
      res = await fetch('/.netlify/functions/editor-photos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session?.access_token ?? ''}` }, body: JSON.stringify({ query }) })
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.')
    }
    const body = (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as { message?: string; photos?: ImageCandidate[] }) : null
    if (!body) throw new Error('Photo search runs as a Netlify function, so it only works on the deployed site or under `netlify dev`.')
    if (!res.ok) throw new Error(body.message ?? `Photo search failed (${res.status}).`)
    return body.photos ?? []
  },
  async automation(today) {
    const [last, gen, pub, ed, config] = await Promise.all([
      supabase!.from('editions').select('edition_date, published_at, published_by').eq('status', 'published').order('edition_date', { ascending: false }).limit(1).maybeSingle(),
      supabase!.from('discovery_runs').select('status, error, started_at, trigger').eq('edition_date', today).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      supabase!.from('publish_runs').select('status, reason, started_at, trigger, details').eq('edition_date', today).neq('status', 'dry_run').order('started_at', { ascending: false }).limit(1).maybeSingle(),
      supabase!.from('editions').select('status, stories(role, headline, rejected_reason, image_url, image_rights_confirmed)').eq('edition_date', today).maybeSingle(),
      automationConfig(),
    ])
    const lib = await supabase!.from('photo_library').select('id', { count: 'exact', head: true }).eq('active', true)
    // The publish log only exists once the Phase 5 migration has been run; until then show "hasn't run yet" instead of failing.
    for (const r of [last, gen, ed]) check(r.error)
    const stories = ((ed.data?.stories ?? []) as { role: StoryRole; headline: string; rejected_reason: string | null; image_url: string | null; image_rights_confirmed: boolean }[])
    const details = (pub.data?.details ?? {}) as { accepted?: unknown[]; rejected?: { headline: string; reasons: string[] }[] }
    return {
      config,
      lastPublished: last.data ? { date: last.data.edition_date as string, publishedAt: last.data.published_at as string, automatic: last.data.published_by === null } : null,
      generation: gen.data ? { status: gen.data.status as string, error: (gen.data.error as string | null) ?? null, startedAt: gen.data.started_at as string, trigger: gen.data.trigger as string } : null,
      publication: pub.data && !pub.error ? { status: pub.data.status as string, reason: (pub.data.reason as string | null) ?? null, startedAt: pub.data.started_at as string, trigger: pub.data.trigger as string, accepted: details.accepted?.length ?? 0, rejected: details.rejected ?? [] } : null,
      today: ed.data ? { status: ed.data.status as string, primary: stories.filter((s) => s.role === 'primary').length, backup: stories.filter((s) => s.role === 'backup').length, withoutPhoto: stories.filter((s) => s.role === 'primary' && !(s.image_url && s.image_rights_confirmed)).length, rejected: stories.filter((s) => s.role === 'rejected').map((s) => ({ headline: s.headline, reason: s.rejected_reason ?? '' })) } : null,
      libraryCount: lib.error ? null : (lib.count ?? 0),
    }
  },
  async checkPublish() {
    const { data: session } = await supabase!.auth.getSession()
    let res: Response
    try {
      res = await fetch('/.netlify/functions/editor-automation', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session?.access_token ?? ''}` }, body: JSON.stringify({ action: 'check' }) })
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.')
    }
    const body = (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as Partial<PublishCheckReport> & { message?: string }) : null
    if (!body) throw new Error('Publish checks run as a Netlify function, so they only work on the deployed site or under `netlify dev`.')
    if (!res.ok) throw new Error(body.message ?? `The check failed (${res.status}).`)
    return { status: body.status ?? 'failed', reason: body.reason ?? '', details: body.details ?? {} }
  },
  async saveToLibrary(photo, category, keywords) {
    const id = photo.url.match(/photo-([\w-]+)/)?.[1] ?? photo.sourceUrl?.split('/').pop()?.split('?')[0]
    if (!id || photo.source !== 'unsplash' || !photo.creditUrl || !photo.sourceUrl || !photo.credit) throw new Error('Only a photo found through the Unsplash search can be saved to the library.')
    // What the photo shows: the words the editor searched with plus its own description. Never the story's headline,
    // or the photo would claim to fit every future story that happens to share a word with it.
    const words = [...new Set(`${keywords} ${photo.alt ?? ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3))]
    const { data: session } = await supabase!.auth.getSession()
    const strip = (u: string) => { const x = new URL(u); x.searchParams.delete('utm_source'); x.searchParams.delete('utm_medium'); return x.toString() }
    const { error } = await supabase!.from('photo_library').upsert(
      { unsplash_id: id, url: photo.url, alt: photo.alt ?? 'Illustrative photo', credit: photo.credit, credit_url: strip(photo.creditUrl), source_url: strip(photo.sourceUrl), download_location: (photo as { downloadLocation?: string | null }).downloadLocation ?? null, categories: [category], keywords: words, added_by: session.session?.user.id ?? null },
      { onConflict: 'unsplash_id' },
    )
    if (error) throw new Error(error.message.includes('photo_library') ? 'The photo library isn’t set up yet. Run the newest migration in Supabase.' : error.message)
  },
  async trackImageUse(storyId) {
    try {
      const { data: session } = await supabase!.auth.getSession()
      await fetch('/.netlify/functions/editor-image-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session?.access_token ?? ''}` },
        body: JSON.stringify({ storyId }),
      })
    } catch {
      /* the notice is a courtesy to the photo provider; never block editing on it */
    }
  },
  async generate() {
    const { data: session } = await supabase!.auth.getSession()
    let res: Response
    try {
      res = await fetch('/.netlify/functions/editor-generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.session?.access_token ?? ''}` },
      })
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.')
    }
    const isJson = (res.headers.get('content-type') ?? '').includes('json')
    const body = (isJson ? await res.json() : {}) as { message?: string; runId?: string; date?: string }
    if (!isJson) throw new Error('Generation runs as a Netlify function, so it only works on the deployed site or under `netlify dev`.')
    if (!res.ok || !body.runId || !body.date) throw new Error(body.message ?? `Generation could not be started (${res.status}).`)

    // The work runs in the background; watch its run record until it finishes.
    // Netlify background functions may run for 15 minutes; the job stops itself at 13 (see store.ts), so wait a little longer than that.
    const deadline = Date.now() + 16 * 60_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4000))
      const { data: run, error } = await supabase!.from('discovery_runs').select('status, error').eq('id', body.runId).single()
      if (error) continue // a brief network blip shouldn't abandon a run that is still going
      if (run.status === 'running') continue
      if (run.status === 'succeeded') {
        const { data: edition } = await supabase!.from('editions').select('id').eq('edition_date', body.date).maybeSingle()
        return { status: 'succeeded', message: 'Today’s draft is ready to review.', editionId: edition?.id as string | undefined }
      }
      return { status: run.status as 'skipped' | 'failed', message: (run.error as string | null) ?? 'The run ended without a draft.' }
    }
    return { status: 'failed', message: 'This is taking longer than expected. The run may still finish: check the editions list in a few minutes.' }
  },
}

/** The server's automation settings, as booleans only. Null if the function can't be reached. */
async function automationConfig(): Promise<AutomationSnapshot['config']> {
  try {
    const { data: session } = await supabase!.auth.getSession()
    const res = await fetch('/.netlify/functions/editor-automation', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session?.access_token ?? ''}` }, body: JSON.stringify({ action: 'status' }) })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    const b = (await res.json()) as { autoPublishEnabled?: boolean; alertsConfigured?: boolean; unsplashConfigured?: boolean; ai?: AiStatus }
    return { autoPublishEnabled: Boolean(b.autoPublishEnabled), alertsConfigured: Boolean(b.alertsConfigured), unsplashConfigured: Boolean(b.unsplashConfigured), ai: b.ai ?? null }
  } catch {
    return null
  }
}

export const editorRepo: EditorRepo = IS_DEMO ? demoRepo : supabaseRepo
