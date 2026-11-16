export type EditionStatus = 'draft' | 'review' | 'published'
export type StoryRole = 'primary' | 'backup' | 'rejected'
export type ImageKind = 'original' | 'illustrative'
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
  /** 'illustrative' = a representative photo, not a picture of the reported event. */
  imageKind: ImageKind | null
  imageLicense: string | null
  /** The photo's own page, for attribution links. */
  imageSourceUrl: string | null
  /** The photographer's (or publisher's) page, for attribution links. */
  imageCreditUrl: string | null
  /** Approved "What happened next?" links (context only: never extra stories). */
  followUps?: import('./followups').FollowUp[]
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
/** A photo the editor can choose for a story. Stored as JSON on the story. */
export interface ImageCandidate {
  url: string
  alt: string | null
  kind: ImageKind
  /** og:image | twitter:image | json-ld | rss | unsplash */
  source: string
  credit: string | null
  creditUrl: string | null
  license: string | null
  sourceUrl: string | null
  /** Unsplash only: the endpoint to notify when this photo is chosen. */
  downloadLocation?: string | null
}

export interface EditorStory extends Omit<PublicStory, 'position'> {
  editionId: string
  role: StoryRole
  /** 1–5 for the edition's five, 1–n for backups, null once rejected. */
  position: number | null
  imageLicense: string | null
  imageKind: ImageKind | null
  /** Where the selected image came from: og:image, unsplash, manual... */
  imageSource: string | null
  imageSourceUrl: string | null
  imageCreditUrl: string | null
  /** Other photos to choose from, e.g. the article's own image (never auto-approved). */
  imageCandidates: ImageCandidate[]
  /** Images only reach readers once approved: by the editor, or by a licensed provider's terms. */
  imageRightsConfirmed: boolean
  /** A person chose or approved this image. Unattended publishing never shows an Unsplash photo without it. */
  imageEditorApproved: boolean
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
    | 'imageKind'
    | 'imageSource'
    | 'imageSourceUrl'
    | 'imageCreditUrl'
    | 'imageCandidates'
    | 'imageRightsConfirmed'
    | 'imageEditorApproved'
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
