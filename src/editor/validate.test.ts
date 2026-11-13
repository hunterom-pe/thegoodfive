import { describe, expect, it } from 'vitest'
import { isHttpUrl, validateStory } from './validate'

const ok = { headline: 'H', summary: 'S', sourceName: 'Paper', sourceUrl: 'https://example.org/a', imageUrl: null, imageRightsConfirmed: false }

describe('validation', () => {
  it('accepts only web links', () => {
    expect(isHttpUrl('https://example.org/story')).toBe(true)
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org', 'example.org', 'https://localhost', '']) expect(isHttpUrl(bad)).toBe(false)
  })
  it('passes a complete story and names the first gap in an incomplete one', () => {
    expect(validateStory(ok)).toBeNull()
    expect(validateStory({ ...ok, headline: ' ' })).toMatch(/headline/i)
    expect(validateStory({ ...ok, sourceUrl: 'javascript:x' })).toMatch(/http/)
    expect(validateStory({ ...ok, imageUrl: 'data:x' })).toMatch(/image/i)
    expect(validateStory({ ...ok, imageRightsConfirmed: true })).toMatch(/image/i)
  })
})
