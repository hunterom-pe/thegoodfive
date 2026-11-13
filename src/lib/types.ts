export type EditionStatus = 'draft' | 'review' | 'published'
export type StoryRole = 'primary' | 'backup' | 'rejected'
export type Category = 'humanity' | 'health' | 'science' | 'nature' | 'progress'

/** What a reader sees. Nothing editorial-only lives on this shape. */
export interface PublicStory {
  id: string
  position: number
  category: Category
  headline: string
  summary: string
  sourceName: string
  sourceUrl: string
  /** When the original article was published (ISO date or timestamp). */
  sourcePublishedAt: string | null
  imageUrl: string | null
  imageAlt: string | null
  imageCredit: string | null
}

export interface PublicEdition {
  id: string
  /** The day this edition is for, as YYYY-MM-DD. */
  date: string
  publishedAt: string | null
  isDemo: boolean
  stories: PublicStory[]
}

export interface EditionSummary {
  id: string
  date: string
  isDemo: boolean
  stories: Pick<PublicStory, 'position' | 'category' | 'headline'>[]
}

/** The editor's view of a story: public fields plus research and review data. */
export interface EditorStory extends Omit<PublicStory, 'position'> {
  editionId: string
  role: StoryRole
  /** 1–5 for the edition's five, 1–n for backups, null once rejected. */
  position: number | null
  imageLicense: string | null
  /** Images only reach readers once the editor has confirmed usage rights. */
  imageRightsConfirmed: boolean
  originalTitle: string | null
  originalExcerpt: string | null
  discoveredVia: string | null
  aiRationale: string | null
  claimsToCheck: string[]
  rejectedReason: string | null
}

export interface EditorEdition {
  id: string
  date: string
  status: EditionStatus
  publishedAt: string | null
  isDemo: boolean
  stories: EditorStory[]
}

export interface EditorEditionSummary {
  id: string
  date: string
  status: EditionStatus
  primaryCount: number
  backupCount: number
}

export type StoryPatch = Partial<
  Pick<
    EditorStory,
    | 'category'
    | 'headline'
    | 'summary'
    | 'sourceName'
    | 'sourceUrl'
    | 'sourcePublishedAt'
    | 'imageUrl'
    | 'imageAlt'
    | 'imageCredit'
    | 'imageLicense'
    | 'imageRightsConfirmed'
  >
>

/** A story entered by hand. Phase 3's pipeline will produce the same shape. */
export interface NewStory {
  role: 'primary' | 'backup'
  category: Category
  headline: string
  summary: string
  sourceName: string
  sourceUrl: string
  sourcePublishedAt: string | null
  imageUrl: string | null
  imageAlt: string | null
  imageCredit: string | null
  imageLicense: string | null
  imageRightsConfirmed: boolean
}
