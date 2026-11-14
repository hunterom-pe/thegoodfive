import { triggerDownload, rankPhotos, searchPhotos, toCandidate, type UnsplashPhoto } from './unsplash.ts'
import type { ImageHint } from './article.ts'
import type { Candidate, DraftStory, StoredImageCandidate } from './types.ts'

export interface ImagePlan {
  /** Concrete visual search terms written by the editor-AI from the story's actual subject. */
  query: string
  aboutPerson: boolean
}

export interface ImageOptions {
  /** Unsplash access key. Without it only the article's own image is offered (as an unapproved candidate). */
  unsplashKey?: string
  /** utm_source for attribution links. Must not contain "unsplash". */
  appName?: string
  log?: (line: string) => void
  /** Overridable for tests. */
  search?: (query: string) => Promise<UnsplashPhoto[]>
  download?: (location: string | null | undefined) => Promise<boolean>
}

/** The publisher's own image, offered as a candidate. Finding it grants no right to publish it. */
export function originalCandidate(candidate: Candidate, hints: ImageHint[]): StoredImageCandidate | null {
  const hint = hints[0] ?? (candidate.imageUrl ? ({ url: candidate.imageUrl, source: 'rss' } as ImageHint) : null)
  if (!hint) return null
  return {
    url: hint.url,
    alt: null,
    kind: 'original',
    source: hint.source,
    credit: candidate.sourceName,
    creditUrl: candidate.url,
    license: null, // unknown: the editor must establish permission
    sourceUrl: candidate.url,
  }
}

/**
 * Give every drafted story an image situation:
 *  - the article's own image is stored as a candidate (never approved here);
 *  - a licensed Unsplash photo that matches the subject is selected and cleared,
 *    because Unsplash's licence covers that specific photo;
 *  - with no Unsplash photo, the article's image is selected but left NOT APPROVED,
 *    so the editor can review it and decide;
 *  - with neither, the story keeps the branded geometric fallback.
 * Illustrative photos are labelled as such and never presented as the event.
 */
export async function attachImages(
  stories: DraftStory[],
  sources: Map<string, { candidate: Candidate; hints: ImageHint[] }>,
  plans: Map<string, ImagePlan>,
  options: ImageOptions = {},
): Promise<DraftStory[]> {
  const log = options.log ?? (() => {})
  const app = options.appName ?? 'thegoodfive'
  const search = options.search ?? (options.unsplashKey ? (q: string) => searchPhotos(q, options.unsplashKey!) : null)
  const download = options.download ?? ((loc: string | null | undefined) => triggerDownload(loc, options.unsplashKey ?? ''))
  const used = new Set<string>()
  const out: DraftStory[] = []

  for (const story of stories) {
    const source = sources.get(story.source_url)
    const plan = plans.get(story.source_url)
    const candidates: StoredImageCandidate[] = []
    const original = source ? originalCandidate(source.candidate, source.hints) : null
    if (original) candidates.push(original)

    let chosen: StoredImageCandidate | null = null
    if (search && plan?.query) {
      try {
        const ranked = rankPhotos(await search(plan.query), plan.query, { aboutPerson: plan.aboutPerson, exclude: used }).slice(0, 3)
        const photos = ranked.map((p) => ({ p, c: toCandidate(p, app, plan.query) }))
        if (photos.length) {
          used.add(photos[0].p.id)
          chosen = photos[0].c
          candidates.push(...photos.map((x) => x.c))
          // Unsplash asks to be told when a photo is chosen.
          void download(chosen.downloadLocation).then((ok) => !ok && log(`Unsplash download notice not sent for ${chosen?.sourceUrl}`))
        } else log(`No suitable photo for "${plan.query}"`)
      } catch (e) {
        log(`Photo search skipped: ${e instanceof Error ? e.message : e}`)
      }
    }

    const selected = chosen ?? original
    const approved = Boolean(chosen) // only the licensed photo is cleared; the publisher's image never is
    out.push({
      ...story,
      image_url: selected?.url ?? null,
      image_alt: selected?.alt ?? null,
      image_credit: selected?.credit ?? null,
      image_credit_url: selected?.creditUrl ?? null,
      image_license: selected?.license ?? null,
      image_kind: selected?.kind ?? null,
      image_source: selected?.source ?? null,
      image_source_url: selected?.sourceUrl ?? null,
      image_candidates: candidates.map(({ downloadLocation, ...rest }) => ({ ...rest, ...(downloadLocation ? { downloadLocation } : {}) })),
      image_rights_confirmed: approved,
    })
  }
  return out
}
