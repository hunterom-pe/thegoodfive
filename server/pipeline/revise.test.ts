import { describe, expect, it } from 'vitest'
import { acceptableRevision, flaggedParts, longestSharedRun } from './revise'

describe('rewriting unconfirmed wording', () => {
  const story = { headline: 'Plans for new marine protected area boost whale shark conservation', summary: 'Plans to create a new marine protected area in Indonesia’s Saleh Bay aim to provide crucial year-round protections for endangered whale sharks. The zone would cover most known hotspots.' }
  it('finds the full text of each flagged clause from its id, though the check shortened it', () => {
    const issues = ['Not stated in the source: H.1 "Plans for new marine protected area boost whale shark conserv"', 'Not stated in the source: S1.1 "Plans to create a new marine protected area in Indonesia’s Saleh Bay aim to prov"']
    const parts = flaggedParts(story, issues)
    expect(parts[0]).toBe(story.headline)
    expect(parts[1]).toContain('endangered whale sharks')
    expect(flaggedParts(story, ['The claim check returned nothing.'])).toEqual([])
  })
  it('accepts a real, modest rewrite and refuses empty, padded, unchanged or runaway ones', () => {
    const fixed = { headline: 'Plans for a marine protected area for whale sharks in Saleh Bay', summary: story.summary.replace('crucial year-round ', '').replace('endangered ', '') }
    expect(acceptableRevision(story, fixed)).toBe(true)
    expect(acceptableRevision(story, { ...story })).toBe(false)
    expect(acceptableRevision(story, { headline: '', summary: fixed.summary })).toBe(false)
    expect(acceptableRevision(story, { headline: fixed.headline, summary: 'Short.' })).toBe(false)
    expect(acceptableRevision(story, { headline: fixed.headline, summary: story.summary + ' '.repeat(5) + 'A new, longer claim was added here to pad it out a great deal more.' })).toBe(false)
    expect(acceptableRevision(story, null)).toBe(false)
  })
  it('refuses a rewrite that pastes the publisher’s sentences in place of a summary', () => {
    const material = 'Plans to create a marine protected area for whale sharks in Indonesia’s Saleh Bay would give the world’s largest fish important new protections across several stages of its lifecycle, conservationists say. Other text follows here.'
    expect(longestSharedRun('the world’s largest fish gets new protections', material)).toBe(4)
    const pasted = { headline: 'Plans for a marine protected area in Saleh Bay', summary: material.split('. ')[0] + '. The zone would cover most known hotspots.' }
    expect(acceptableRevision(story, pasted, material)).toBe(false)
    const own = { headline: 'Plans for a marine protected area in Saleh Bay', summary: 'Conservationists say a planned marine protected area in Saleh Bay, Indonesia, would protect whale sharks at several stages of life. The zone would cover most known hotspots.' }
    expect(acceptableRevision(story, own, material)).toBe(true)
  })
})
