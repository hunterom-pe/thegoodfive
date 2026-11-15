import { describe, expect, it } from 'vitest'
import { libraryCandidate, pickFromLibrary, type LibraryPhoto } from './library'

const photo = (id: string, over: Partial<LibraryPhoto> = {}): LibraryPhoto => ({
  id, unsplashId: id, url: `https://images.unsplash.com/photo-${id}?ixid=abc`, alt: 'A photo', credit: 'Ada Lens', creditUrl: 'https://unsplash.com/@ada',
  sourceUrl: `https://unsplash.com/photos/${id}`, downloadLocation: `https://api.unsplash.com/photos/${id}/download?ixid=abc`, categories: ['nature'], keywords: [], generic: false, showsPeople: false, lastUsedOn: null, ...over,
})
const story = { category: 'nature', headline: 'Wild bees return to a restored meadow', summary: 'Ecologists recorded 41 species of wild bee in a restored meadow this summer.' }
const ctx = { today: '2026-11-16', used: new Set<string>(), aboutPerson: false }

describe('choosing a photo from the library', () => {
  it('prefers the photo whose subject matches the story', () => {
    const lib = [photo('a', { keywords: ['coral reef'], alt: 'Coral reef underwater' }), photo('b', { keywords: ['wild bees', 'meadow'], alt: 'Bees on flowers' })]
    expect(pickFromLibrary(story, lib, ctx)?.id).toBe('b')
  })
  it('does not use an unrelated photo, but will use a general picture for the category', () => {
    expect(pickFromLibrary(story, [photo('a', { keywords: ['coral reef'], alt: 'Coral reef underwater' })], ctx)).toBeNull()
    expect(pickFromLibrary(story, [photo('g', { generic: true, alt: 'Misty forest' })], ctx)?.id).toBe('g')
  })
  it('stays within the story’s category', () => {
    expect(pickFromLibrary(story, [photo('h', { categories: ['health'], keywords: ['wild bees'] })], ctx)).toBeNull()
  })
  it('never shows people for a story about a specific person', () => {
    const lib = [photo('p', { keywords: ['meadow'], showsPeople: true })]
    expect(pickFromLibrary(story, lib, { ...ctx, aboutPerson: true })).toBeNull()
    expect(pickFromLibrary(story, lib, ctx)?.id).toBe('p')
  })
  it('does not give one photo to two stories, and rests a photo after it is used', () => {
    const lib = [photo('a', { keywords: ['meadow'] })]
    expect(pickFromLibrary(story, lib, { ...ctx, used: new Set(['a']) })).toBeNull()
    // Rested photos win over recently used ones...
    const both = [photo('recent', { keywords: ['meadow'], lastUsedOn: '2026-11-15' }), photo('old', { keywords: ['meadow'], lastUsedOn: '2026-10-01' })]
    expect(pickFromLibrary(story, both, ctx)?.id).toBe('old')
    // ...but a small library still gives a photo, the one used longest ago, rather than none.
    const small = [photo('a', { keywords: ['meadow'], lastUsedOn: '2026-11-15' }), photo('b', { keywords: ['meadow'], lastUsedOn: '2026-11-12' })]
    expect(pickFromLibrary(story, small, ctx)?.id).toBe('b')
    expect(pickFromLibrary(story, [photo('a', { keywords: ['meadow'], lastUsedOn: '2026-11-01' })], ctx)?.id).toBe('a')
  })
  it('returns nothing from an empty library', () => {
    expect(pickFromLibrary(story, [], ctx)).toBeNull()
  })
})

describe('a library photo as a story image', () => {
  it('is labelled illustrative, credited to the photographer, and keeps its links and source URL', () => {
    const c = libraryCandidate(photo('a'), 'thegoodfive')
    expect(c).toMatchObject({ kind: 'illustrative', source: 'unsplash', credit: 'Ada Lens', license: 'Unsplash License' })
    expect(c.creditUrl).toBe('https://unsplash.com/@ada?utm_source=thegoodfive&utm_medium=referral')
    expect(c.url).toContain('ixid=abc')
  })
})
