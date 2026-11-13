import { demoStore } from '../data/demoStore'
import { IS_DEMO } from '../lib/config'
import type { Category, EditionStatus, EditorEdition, EditorEditionSummary, EditorStory, NewStory, StoryPatch, StoryRole } from '../lib/types'
import type { Lineup } from './lineup'
import { supabase } from './supabaseClient'

/**
 * Everything the editor can do. The Supabase implementation is thin on
 * purpose: the database decides what is allowed (see the migration), and
 * this file only asks.
 */
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
  image_url: string | null
  image_alt: string | null
  image_credit: string | null
  image_license: string | null
  image_rights_confirmed: boolean
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
  imageUrl: r.image_url,
  imageAlt: r.image_alt,
  imageCredit: r.image_credit,
  imageLicense: r.image_license,
  imageRightsConfirmed: r.image_rights_confirmed,
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
    const row = Object.fromEntries(Object.entries(patch).map(([k, v]) => [COLUMN[k as keyof StoryPatch], v === '' ? null : v]))
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
    const deadline = Date.now() + 12 * 60_000
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
    return { status: 'failed', message: 'This is taking longer than expected. Check the editions list in a few minutes.' }
  },
}

export const editorRepo: EditorRepo = IS_DEMO ? demoRepo : supabaseRepo
