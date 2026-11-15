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

describe('relevance rules', () => {
  const sciStory = { category: 'science', headline: 'Physicists use laser light to unlock properties in a crystal', summary: 'Researchers shone laser light on a crystal and measured its electrical response.' }
  it('a shared common word (light, water, white) is not a subject match', () => {
    const textile = photo('t', { categories: ['science'], keywords: ['floral', 'textile'], alt: 'Black and white floral textile with light colours' })
    expect(pickFromLibrary(sciStory, [textile], ctx)).toBeNull()
    const lamp = photo('l', { categories: ['science'], keywords: ['water', 'light'], alt: 'Water and light' })
    expect(pickFromLibrary(sciStory, [lamp], ctx)).toBeNull()
  })
  it('a real subject word matches, singular or plural', () => {
    const turbines = photo('w', { categories: ['progress'], keywords: ['turbines', 'wind'], alt: 'Wind turbines' })
    const story = { category: 'progress', headline: 'Wind turbine output hits a record', summary: 'The turbine fleet produced more power than ever.' }
    expect(pickFromLibrary(story, [turbines], ctx)?.id).toBe('w')
    const stars = photo('s', { categories: ['science'], keywords: ['star', 'astronomy'], alt: 'A cluster of blue stars' })
    expect(pickFromLibrary({ category: 'science', headline: 'Astronomers map thousands of stars', summary: 'A new survey charts stars.' }, [stars], ctx)?.id).toBe('s')
  })
  it('a photo that matches the subject beats a neutral one', () => {
    const neutral = photo('n', { categories: ['nature'], keywords: ['scenery'], generic: true, alt: 'Green hills' })
    const coral = photo('c', { categories: ['nature'], keywords: ['coral', 'reef', 'marine'], alt: 'Coral reef' })
    expect(pickFromLibrary({ category: 'nature', headline: 'Coral reef sanctuary declared', summary: 'Marine protection for the reef.' }, [neutral, coral], ctx)?.id).toBe('c')
  })
  it('a neutral picture serves an ordinary story but never a sensitive one', () => {
    const hills = photo('n', { categories: ['health'], generic: true, keywords: ['hospital', 'corridor'], alt: 'Empty hospital corridor' })
    const ordinary = { category: 'health', headline: 'Walking schedule linked to less pain', summary: 'Regular routines helped older adults.' }
    expect(pickFromLibrary(ordinary, [hills], ctx)?.id).toBe('n')
    for (const headline of ['Infant becomes seizure-free after treatment', 'Alzheimer’s may shrink brain regions years early', 'Wartime bravery of woman who hid troops revealed', 'Family of cancer survivor thanks nurses']) {
      expect(pickFromLibrary({ category: 'health', headline, summary: 'A report says so.' }, [hills], ctx), headline).toBeNull()
    }
  })
  it('a story about a specific person never gets a neutral picture, only a genuine subject match without people', () => {
    const hills = photo('n', { categories: ['humanity'], generic: true, keywords: ['village', 'street'], alt: 'Village street' })
    const person = { category: 'humanity', headline: 'Long-lost draft of a famous speech resurfaces', summary: 'The speech draft was found in an archive.' }
    expect(pickFromLibrary(person, [hills], { ...ctx, aboutPerson: true })).toBeNull()
    const archive = photo('a', { categories: ['humanity'], keywords: ['archive', 'speech', 'manuscript'], alt: 'Archive manuscripts' })
    expect(pickFromLibrary(person, [archive], { ...ctx, aboutPerson: true })?.id).toBe('a')
    const crowd = photo('p', { categories: ['humanity'], showsPeople: true, keywords: ['speech'], alt: 'Crowd listening to a speech' })
    expect(pickFromLibrary(person, [crowd], { ...ctx, aboutPerson: true })).toBeNull()
  })
})
