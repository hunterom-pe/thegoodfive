import { describe, expect, it } from 'vitest'
import { story, NOW } from '../fixtures'
import { evaluateStory, groundingRatio, namesIn, namesInText, selectFive, sentenceCaseHeadline, type GateStory } from './gates'
import { hostOf, isTrusted } from './sources'

const gate = (s = story(0), over: Partial<GateStory> = {}) =>
  evaluateStory({ headline: s.headline, summary: s.summary, category: s.category, sourceName: s.sourceName, sourceUrl: s.sourceUrl, sourcePublishedAt: s.sourcePublishedAt, sourceMaterial: s.sourceMaterial, aiRationale: s.aiRationale, ...over }, { now: NOW, recentUrls: new Set() })
const codes = (over: Partial<GateStory>, s = story(0)) => gate(s, over).failures.map((f) => f.code)

describe('verification gates', () => {
  it('passes a well-sourced, correctly written story', () => {
    const r = gate()
    expect(r.failures).toEqual([])
    expect(r.ok).toBe(true)
  })

  describe('sources', () => {
    it('accepts trusted publishers and their subdomains, and rejects look-alikes and unknown sites', () => {
      expect(isTrusted('https://news.mongabay.com/x')).toBe(true)
      expect(isTrusted('https://www.bbc.co.uk/news/1')).toBe(true)
      expect(isTrusted('https://bbc.co.uk.evil.example/1')).toBe(false)
      expect(isTrusted('https://notbbc.co.uk/1')).toBe(false)
      expect(isTrusted('https://random-blog.example/1')).toBe(false)
    })
    it('rejects insecure, local, numeric and malformed links', () => {
      for (const url of ['http://www.bbc.co.uk/news/1', 'https://localhost/a', 'https://192.168.1.5/a', 'javascript:alert(1)', 'not a url', '']) expect(codes({ sourceUrl: url }), url).toContain('url_invalid')
      expect(hostOf('https://www.bbc.co.uk/x')).toBe('bbc.co.uk')
    })
    it('flags an untrusted source', () => expect(codes({ sourceUrl: 'https://random-blog.example/post' })).toContain('source_not_trusted'))
    it('requires the publisher name and a positive assessment', () => {
      expect(codes({ sourceName: ' ' })).toContain('no_source_name')
      expect(codes({ aiRationale: null })).toContain('no_positive_assessment')
    })
  })

  describe('evidence', () => {
    it('needs enough source text', () => expect(codes({ sourceMaterial: 'short' })).toContain('insufficient_evidence'))
    it('rejects figures, quotations and dates that are not in the source', () => {
      expect(codes({ summary: story(0).summary + ' It cost 4,500 dollars.' })).toContain('numbers_unsupported')
      expect(codes({ summary: story(0).summary + ' “Nothing like it has ever happened here,” a resident said.' })).toContain('quote_unsupported')
      expect(codes({ summary: story(0).summary + ' It was announced in September.' })).toContain('numbers_unsupported')
    })
    it('does not mistake the verb "may" for the month, and still catches a real May date', () => {
      expect(codes({ summary: story(0).summary + ' The recovery may continue.' })).not.toContain('numbers_unsupported')
      expect(codes({ summary: story(0).summary + ' It began on 12 May.' })).toContain('numbers_unsupported')
    })
    it('accepts a verbatim quotation that is in the source', () => {
      const material = story(0).sourceMaterial + ' “We just kept turning up,” said Maria Santos.'
      expect(codes({ sourceMaterial: material, summary: story(0).summary + ' “We just kept turning up,” said Maria Santos.' })).toEqual([])
    })
    it('rejects names that appear nowhere in the source, in the headline or (beyond one) in the summary', () => {
      expect(codes({ headline: 'Rangers count record turtle nests on the Barrow coast' })).toContain('entities_unsupported')
      expect(codes({ summary: story(0).summary + ' Governor Hendricks and Senator Okonkwo praised it.' })).toContain('entities_unsupported')
      expect(gate(story(0), { summary: story(0).summary + ' Governor Hendricks praised it.' }).warnings.length).toBeGreaterThan(0) // one name is only noted
    })
    it('normalises a Title Case headline to sentence case, keeping names the story itself capitalises', () => {
      const names = namesInText(story(0).summary, story(0).sourceMaterial!)
      expect(sentenceCaseHeadline('Rangers Count Record Turtle Nests Along The Calder Coast', names)).toBe('Rangers count record turtle nests along the Calder Coast')
      expect(sentenceCaseHeadline('Villagers Use Creative Non-Lethal Methods To Deter Elephants', [])).toBe('Villagers use creative non-lethal methods to deter elephants')
      expect(sentenceCaseHeadline('NASA Finds 312 Salmon In Alder River', ['Alder'])).toBe('NASA finds 312 salmon in Alder river'.replace('Alder river', 'Alder River').replace('Alder River', 'Alder river'))
      // already sentence case: untouched
      expect(sentenceCaseHeadline('Rangers count record turtle nests on the Calder coast', names)).toBe('Rangers count record turtle nests on the Calder coast')
    })
    it('after normalising, a Title Case headline passes the name check, and a made-up capitalised name still fails', () => {
      const names = namesInText(story(0).summary, story(0).sourceMaterial!)
      const ok = sentenceCaseHeadline('Rangers Count Record Turtle Nests Along The Calder Coast', names)
      expect(codes({ headline: ok })).not.toContain('entities_unsupported')
      expect(codes({ headline: 'Rangers count record turtle nests on the Barrow coast' })).toContain('entities_unsupported')
    })
    it('rejects a summary that is not traceable to the source', () => {
      const invented = 'Researchers announced a sweeping programme that will transform education nationwide, delivering dramatic improvements across every classroom and every community within months, according to officials who described remarkable enthusiasm among parents, pupils, governors and employers across the whole country.'
      expect(codes({ summary: invented })).toContain('weakly_grounded')
      expect(groundingRatio(story(0).summary, story(0).sourceMaterial!)).toBeGreaterThan(0.9)
    })
    it('finds names in text but not sentence-initial words', () => {
      expect(namesIn('Rangers counted nests. The beach, near Calder Coast Trust, thrived.')).toEqual(['Calder', 'Coast', 'Trust'])
    })
  })

  describe('headline and tone', () => {
    it('rejects hype, shouting, questions and exclamations', () => {
      expect(codes({ headline: 'Amazing breakthrough cures turtle decline on the Calder coast' })).toContain('headline_hype')
      expect(codes({ headline: 'Rangers count record turtle nests on the Calder coast!' })).toContain('headline_form')
      expect(codes({ headline: 'Are record turtle nests on the Calder coast good news?' })).toContain('headline_form')
      expect(codes({ headline: 'TURTLE NESTS reach record numbers on the Calder coast' })).toContain('headline_form')
      expect(codes({ headline: 'Nests rise' })).toContain('headline_form')
    })
    it('rejects negative headlines and unsuitable language', () => {
      expect(codes({ headline: 'Crash kills dozens as Calder coast turtle patrol overturns' })).toContain('not_positive')
      expect(codes({ summary: story(0).summary + ' The earlier suicide of a ranger prompted the scheme.' })).toContain('sensitive_content')
    })
    it('requires a sensible summary length', () => {
      expect(codes({ summary: 'Rangers on the Calder coast counted 1,140 turtle nests.' })).toContain('summary_length')
    })
  })

  describe('freshness and repeats', () => {
    it('rejects stale, undated and future-dated sources', () => {
      expect(codes({ sourcePublishedAt: '2026-11-01T00:00:00Z' })).toContain('stale')
      expect(codes({ sourcePublishedAt: null })).toContain('undated')
      expect(codes({ sourcePublishedAt: '2026-11-20T00:00:00Z' })).toContain('future_dated')
    })
    it('rejects an article that ran recently, even behind a tracking link', () => {
      const s = story(0)
      const r = evaluateStory({ headline: s.headline, summary: s.summary, category: s.category, sourceName: s.sourceName, sourceUrl: `${s.sourceUrl}?utm_source=x`, sourcePublishedAt: s.sourcePublishedAt, sourceMaterial: s.sourceMaterial, aiRationale: s.aiRationale }, { now: NOW, recentUrls: new Set(['bbc.co.uk/news/articles/c0']) })
      expect(r.failures.map((f) => f.code)).toContain('recent_duplicate')
    })
  })
})

describe('choosing the five', () => {
  const cand = (id: string, headline: string, url: string, ok = true) => ({ item: id, headline, sourceUrl: url, result: { ok, failures: ok ? [] : [{ code: 'stale' as const, message: 'old' }], warnings: [] } })
  it('keeps the first five that pass, in order, and counts spares as neither used nor rejected', () => {
    const list = ['alpha river', 'bravo forest', 'charlie coral', 'delta glacier', 'echo orchard', 'foxtrot meadow'].map((h, i) => cand(`s${i}`, h, `https://x.org/${i}`))
    const { chosen, rejected } = selectFive(list, 5)
    expect(chosen).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(rejected).toEqual([])
  })
  it('skips failures and near-duplicates', () => {
    const { chosen, rejected } = selectFive([cand('a', 'Rangers count record turtle nests on the coast', 'https://x.org/1'), cand('b', 'Record turtle nests counted on the coast by rangers', 'https://x.org/2'), cand('c', 'Library van lends books', 'https://x.org/3', false), cand('d', 'Solar field powers the town', 'https://x.org/4')], 5)
    expect(chosen).toEqual(['a', 'd'])
    expect(rejected.map((r) => r.item).sort()).toEqual(['b', 'c'])
  })
})
