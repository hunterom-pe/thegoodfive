import { describe, expect, it } from 'vitest'
import { NOW, story } from '../fixtures'
import { evaluateStory } from './gates'
import { clausesOf, judge, meaningWords, statementsOf, type VerifyInput } from './verify'

type Verdict = 'supported' | 'contradicted' | 'not_in_source'
const sentencesOf = (t: string) => t.split(/(?<=[.!?])\s+/)

/** An answer judging each given clause id, citing a real source sentence (or a made-up one). */
const answer = (entries: [string, Verdict, string][]) => ({ clauses: entries.map(([id, verdict, evidence]) => ({ id, verdict, evidence })) })
/** A complete, honest answer: every clause supported by the first source sentence that shares its opening words. */
function supportAll(input: VerifyInput, skip: (clause: string) => boolean = () => false) {
  const src = sentencesOf(input.material)
  return answer(
    statementsOf(input)
      .flatMap((s) => s.clauses)
      .filter((c) => !skip(c.text))
      .map((c) => [c.id, 'supported', src.find((x) => x.toLowerCase().includes(c.text.replace(/[.,]$/, '').slice(0, 25).toLowerCase())) ?? src[0]] as [string, Verdict, string]),
  )
}

const material = 'Rangers on the Calder coast counted 1,140 turtle nests this season, the most since records began in 1996. The council funded the programme.'
const input: VerifyInput = { headline: 'Rangers count turtle nests', summary: 'Rangers counted 1,140 turtle nests. The council funded the programme.', material }
const S1 = 'Rangers on the Calder coast counted 1,140 turtle nests this season, the most since records began in 1996.'
const S2 = 'The council funded the programme.'

describe('the statements and clauses the verifier must answer for', () => {
  it('gives the headline and each sentence stable ids, and each clause its own', () => {
    expect(statementsOf(input)).toEqual([
      { id: 'H', text: 'Rangers count turtle nests', clauses: [{ id: 'H.1', text: 'Rangers count turtle nests' }] },
      { id: 'S1', text: 'Rangers counted 1,140 turtle nests.', clauses: [{ id: 'S1.1', text: 'Rangers counted 1,140 turtle nests.' }] },
      { id: 'S2', text: S2, clauses: [{ id: 'S2.1', text: S2 }] },
    ])
  })
  it('splits added clauses, compound statements and lists, but not numbers', () => {
    expect(clausesOf('Rangers counted 1,140 nests and created jobs.')).toEqual(['Rangers counted 1,140 nests', 'and created jobs.'])
    expect(clausesOf('Visitor numbers rose while costs fell, saving the council money.')).toEqual(['Visitor numbers rose', 'while costs fell', 'saving the council money.'])
    expect(clausesOf('Shops, bakeries and cafes donate food.')).toEqual(['Shops', 'bakeries', 'and cafes donate food.'])
    expect(clausesOf('It cost £1,200; donors paid it all.')).toEqual(['It cost £1,200', 'donors paid it all.'])
    expect(clausesOf('Rangers counted 1,140 nests.')).toEqual(['Rangers counted 1,140 nests.'])
  })
  it('keeps negations, qualifiers and numbers as meaning, and drops pure grammar', () => {
    expect(meaningWords("didn't")).toEqual(['not'])
    expect(meaningWords('only about 1,140 more than')).toEqual(['only', 'about', '1140', 'more', 'than'])
    expect(meaningWords('it is the and of')).toEqual([])
  })
})

describe('the audit case: a short clause added to a sentence', () => {
  const s = story(0)
  const first = sentencesOf(s.summary)[0]
  const edited = s.summary.replace(first, first.replace(/\.$/, ' and created jobs.'))
  const withJobs: VerifyInput = { headline: s.headline, summary: edited, material: s.sourceMaterial! }
  it('judge(): an answer that covers the original text but not the new clause is inconclusive and names it', () => {
    const v = judge(supportAll(withJobs, (c) => c === 'and created jobs.'), withJobs)
    expect(v.verdict).toBe('inconclusive')
    expect(v.issues.join(' ')).toMatch(/Not checked: S1\.\d+ \("and created jobs\."\)/)
  })
  it('judge(): the same complete answer for the unedited summary is verified (complete, not merely stricter)', () => {
    const plain = { ...withJobs, summary: s.summary }
    expect(judge(supportAll(plain), plain).verdict).toBe('verified')
  })
  it('judge(): even "supported" with a citation for the jobs clause needs that citation to exist in the source', () => {
    const fake = supportAll(withJobs)
    const jobs = statementsOf(withJobs).flatMap((x) => x.clauses).find((c) => c.text === 'and created jobs.')!
    fake.clauses = fake.clauses.map((c) => (c.id === jobs.id ? { ...c, evidence: 'The programme created dozens of new jobs on the coast.' } : c))
    expect(judge(fake, withJobs).verdict).toBe('inconclusive')
  })
  it('evaluateStory(): the gate flags the clause it cannot find in the source', () => {
    const r = evaluateStory({ ...s, summary: edited }, { now: NOW, recentUrls: new Set() })
    expect(r.unaligned).toContain('and created jobs.')
    expect(r.warnings.join(' ')).toMatch(/only the claim check can confirm it: "and created jobs/)
  })
})

describe('omitted negations and qualifiers', () => {
  // The negation or qualifier sits inside its clause, so the clause has to be judged as a whole; an answer that
  // leaves the clause out is incomplete. Whether the model notices the word is the part that stays with the AI.
  for (const sentence of ['The council did not fund the programme.', 'Only 12 nests were found.', 'About 400 families are fed each week.', 'More than 300 volunteers took part.', 'The drug may slow memory loss.']) {
    it(`"${sentence}": skipping its clause is inconclusive`, () => {
      const i = { headline: 'Rangers count turtle nests', summary: `Rangers counted 1,140 turtle nests. ${sentence}`, material }
      expect(judge(supportAll(i, (c) => c === sentence), i).verdict).toBe('inconclusive')
    })
  }
})

describe('invalid or incomplete answers are never verified', () => {
  const full = () => answer([['H.1', 'supported', S1], ['S1.1', 'supported', S1], ['S2.1', 'supported', S2]])
  it('verifies a complete, valid answer backed by real source sentences', () => {
    expect(judge(full(), input).verdict).toBe('verified')
  })
  it('repeated answers cannot stand in for missing ones (the earlier audit case)', () => {
    const lib = { headline: 'Volunteers opened a community library', summary: 'Volunteers opened a community library. The project guaranteed every resident a paid job.', material: 'Volunteers opened a community library. It lends books and hosts reading groups.' }
    const ev = 'Volunteers opened a community library.'
    expect(judge(answer([['H.1', 'supported', ev], ['S1.1', 'supported', ev], ['S1.1', 'supported', ev]]), lib)).toMatchObject({ verdict: 'inconclusive', issues: expect.arrayContaining([expect.stringMatching(/answered clause S1.1 2 times/), expect.stringMatching(/Not checked: S2.1/)]) })
  })
  it('rejects duplicate, missing and unknown ids, and malformed answers', () => {
    expect(judge(answer([...full().clauses.map((c) => [c.id, c.verdict, c.evidence] as [string, Verdict, string]), ['S1.1', 'supported', S1]]), input).issues.join(' ')).toMatch(/answered clause S1.1 2 times/)
    expect(judge(answer([['S1.1', 'supported', S1], ['S2.1', 'supported', S2]]), input).issues.join(' ')).toMatch(/Not checked: H.1/)
    expect(judge(answer([...full().clauses.map((c) => [c.id, c.verdict, c.evidence] as [string, Verdict, string]), ['S9.1', 'supported', S2]]), input).issues.join(' ')).toMatch(/does not exist \(S9.1\)/)
    for (const bad of [null, undefined, {}, { clauses: [] }, { clauses: 'nope' }, { clauses: [null, 3] }, { statements: [] }] as never[]) expect(judge(bad, input).verdict).toBe('inconclusive')
  })
  it('does not trust evidence that is not in the source', () => {
    expect(judge(answer([['H.1', 'supported', S1], ['S1.1', 'supported', 'Rangers on the Calder coast did not count turtle nests.'], ['S2.1', 'supported', S2]]), input).verdict).toBe('inconclusive')
  })
  it('a clause the source does not state is inconclusive', () => {
    expect(judge(answer([['H.1', 'supported', S1], ['S1.1', 'supported', S1], ['S2.1', 'not_in_source', '']]), input).verdict).toBe('inconclusive')
  })
  it('calls a conflict only when the cited sentence is real', () => {
    expect(judge(answer([['H.1', 'supported', S1], ['S1.1', 'supported', S1], ['S2.1', 'contradicted', S2]]), input).verdict).toBe('contradicted')
    expect(judge(answer([['H.1', 'supported', S1], ['S1.1', 'supported', S1], ['S2.1', 'contradicted', 'A sentence that is not there at all, honestly.']]), input).verdict).toBe('inconclusive')
  })
})
