import { describe, expect, it } from 'vitest'
import { story, NOW } from '../fixtures'
import { checkClaims, quantitiesIn, swappedActors, unitMismatches } from './claims'
import { evaluateStory } from './gates'

const MATERIAL =
  'Rangers on the Calder coast counted 1,140 turtle nests this season, the most since records began in 1996. Mayor Elena Ruiz thanked Captain Omar Haddad for the fishing crews who adopted turtle-friendly nets. The programme costs $2 million a year and was funded by the council. Surveyors said the beach saw fewer than fifty nests a year before towns dimmed their lights.'

const kinds = (summary: string, headline = 'Rangers count turtle nests on the Calder coast') => checkClaims(headline, summary, MATERIAL).findings.map((f) => f.kind)

describe('the audit case: a denied claim must not pass', () => {
  it('holds a story whose summary denies what the source affirms', () => {
    const s = story(0)
    s.summary = s.summary.replace('counted 1,140', 'did not count 1,140')
    const r = evaluateStory(s, { now: NOW, recentUrls: new Set() })
    expect(r.ok).toBe(false)
    expect(r.failures.map((f) => f.code)).toContain('claim_contradiction')
  })
  it('still passes the untouched fixture', () => {
    expect(evaluateStory(story(0), { now: NOW, recentUrls: new Set() }).ok).toBe(true)
  })
})

describe('negation', () => {
  it('flags a claim negated in the summary only, and the reverse', () => {
    expect(kinds('Rangers on the Calder coast did not count 1,140 turtle nests this season.')).toContain('contradiction')
    expect(checkClaims('h', 'Rangers on the Calder coast counted 1,140 turtle nests this season.', 'Rangers on the Calder coast did not count 1,140 turtle nests this season, the report said.').findings.map((f) => f.kind)).toContain('contradiction')
  })
  it('accepts matching negation', () => {
    expect(checkClaims('h', 'The council did not fund the programme alone, officials said.', 'The council did not fund the programme alone, officials said on Monday.').findings).toEqual([])
  })
})

describe('opposites', () => {
  it('flags rose against fell', () => {
    const r = checkClaims('h', 'Visitor numbers fell sharply across the three coastal parks this year.', 'Visitor numbers rose sharply across the three coastal parks this year, rangers said.')
    expect(r.findings.map((f) => f.kind)).toContain('contradiction')
  })
})

describe('numbers and their units', () => {
  it('reads figures with scale, percent, currency and rate', () => {
    expect(quantitiesIn('$2 million a year')[0]).toMatchObject({ value: 2_000_000, unit: '$', rate: 'year' })
    expect(quantitiesIn('about 110 seizures a day')[0]).toMatchObject({ value: 110, rate: 'day' })
    expect(quantitiesIn('40% of 1.2 million people')).toEqual(expect.arrayContaining([expect.objectContaining({ value: 40, unit: '%' }), expect.objectContaining({ value: 1_200_000 })]))
  })
  it('flags a figure given a different unit or rate than the source', () => {
    expect(unitMismatches('The programme costs $2 million a month.', MATERIAL).join(' ')).toMatch(/per month/)
    expect(unitMismatches('Rangers counted 1,140 rangers this season.', MATERIAL).join(' ')).toMatch(/unit/)
    expect(unitMismatches('Spending is 2 million people.', MATERIAL).length).toBe(1)
  })
  it('accepts the same figure in the same unit', () => {
    expect(unitMismatches('Rangers counted 1,140 turtle nests.', MATERIAL)).toEqual([])
    expect(unitMismatches('The programme costs $2 million a year.', MATERIAL)).toEqual([])
  })
})

describe('swapped actors', () => {
  const src = 'Mayor Elena Ruiz thanked Captain Omar Haddad for the fishing crews.'
  it('flags reversed roles, active or passive', () => {
    expect(swappedActors('Captain Omar Haddad thanked Mayor Elena Ruiz for the fishing crews.', src)).toMatch(/opposite roles/)
    expect(swappedActors('Mayor Elena Ruiz was thanked by Captain Omar Haddad for the fishing crews.', src)).toMatch(/opposite roles/)
  })
  it('accepts the same roles, active or passive', () => {
    expect(swappedActors('Mayor Elena Ruiz thanked Captain Omar Haddad.', src)).toBeNull()
    expect(swappedActors('Captain Omar Haddad was thanked by Mayor Elena Ruiz.', src)).toBeNull()
  })
  it('works through the whole check', () => {
    expect(kinds('Captain Omar Haddad thanked Mayor Elena Ruiz for the fishing crews who adopted turtle-friendly nets.')).toContain('swapped_actors')
  })
})

describe('conclusions the source does not draw', () => {
  it('flags an invented cause', () => {
    expect(kinds('Rangers counted 1,140 turtle nests because the council funded the programme.')).toContain('unsupported_conclusion')
  })
  it('accepts a cause the source states', () => {
    const r = checkClaims('h', 'Nest numbers rose because towns dimmed their seafront lights this season.', 'Nest numbers rose this season because towns dimmed their seafront lights, rangers said on Tuesday.')
    expect(r.findings.filter((f) => f.kind === 'unsupported_conclusion')).toEqual([])
  })
  it('flags an absolute the source never uses', () => {
    expect(kinds('Rangers counted 1,140 turtle nests, the largest count ever recorded on the Calder coast.')).toContain('unsupported_conclusion')
  })
})

describe('what it cannot settle', () => {
  it('reports sentences with no counterpart in the source rather than calling them verified', () => {
    const r = checkClaims('h', 'Scientists elsewhere expect similar programmes to spread across several continents within a decade.', MATERIAL)
    expect(r.unaligned.length).toBe(1)
    expect(r.findings).toEqual([])
  })
})
