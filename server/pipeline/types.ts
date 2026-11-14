export type Category = 'humanity' | 'health' | 'science' | 'nature' | 'progress'
export const CATEGORIES: Category[] = ['humanity', 'health', 'science', 'nature', 'progress']

/** A news item as discovered, before any AI has looked at it. */
export interface Candidate {
  id: string
  title: string
  url: string
  sourceName: string
  /** ISO timestamp, or null when the source didn't say. */
  publishedAt: string | null
  /** Text supplied by the feed itself. Empty for GDELT, which only gives headlines. */
  excerpt: string
  via: string
  /** 1–3: how much we trust this outlet's reporting, set by hand in feeds.ts. */
  trust: number
  /** The feed's own image for this item (media:content, enclosure...), if any. Only a candidate. */
  imageUrl?: string | null
}

/** Where a candidate image came from. */
export type ImageOrigin = 'og:image' | 'twitter:image' | 'json-ld' | 'rss'

/** A photo option stored with a story (mirrors the editor's ImageCandidate). */
export interface StoredImageCandidate {
  url: string
  alt: string | null
  kind: 'original' | 'illustrative'
  source: string
  credit: string | null
  creditUrl: string | null
  license: string | null
  sourceUrl: string | null
  /** Unsplash only: the endpoint to call when a photo is chosen. Server-side use only. */
  downloadLocation?: string | null
}

export interface Evaluation {
  id: string
  isGoodNews: boolean
  category: Category
  /** 1–5: how much this matters beyond the people directly involved. */
  significance: number
  /** 1–5: how well sourced and specific the report appears. */
  credibility: number
  reason: string
}

/** A finished story, ready to be stored as part of a draft. */
export interface DraftStory {
  role: 'primary' | 'backup'
  position: number
  category: Category
  headline: string
  summary: string
  source_name: string
  source_url: string
  source_published_at: string | null
  original_title: string
  original_excerpt: string
  discovered_via: string
  ai_rationale: string
  claims_to_check: string[]
  image_url?: string | null
  image_alt?: string | null
  image_credit?: string | null
  image_credit_url?: string | null
  image_license?: string | null
  image_kind?: 'original' | 'illustrative' | null
  image_source?: string | null
  image_source_url?: string | null
  image_candidates?: StoredImageCandidate[]
  /** True only for a licensed provider's photo whose terms cover this exact image. */
  image_rights_confirmed?: boolean
}
