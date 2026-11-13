import type { NewStory } from '../lib/types'

/** Only plain web links are accepted anywhere: no javascript:, data:, file: and so on. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

/** First problem with a story, in plain words, or null if it is fit to save. The database re-checks all of this. */
export function validateStory(s: Pick<NewStory, 'headline' | 'summary' | 'sourceName' | 'sourceUrl' | 'imageUrl' | 'imageRightsConfirmed'>): string | null {
  if (!s.headline.trim()) return 'Add a headline.'
  if (s.headline.length > 220) return 'The headline is too long (220 characters at most).'
  if (!s.summary.trim()) return 'Add a summary.'
  if (s.summary.length > 1800) return 'The summary is too long.'
  if (!s.sourceName.trim()) return 'Name the publisher of the original article.'
  if (!isHttpUrl(s.sourceUrl)) return 'The original article link must be a full web address starting with http:// or https://.'
  if (s.imageUrl && !isHttpUrl(s.imageUrl)) return 'The image link must be a full web address starting with http:// or https://.'
  if (s.imageRightsConfirmed && !s.imageUrl) return 'Add an image link before confirming image rights.'
  return null
}
