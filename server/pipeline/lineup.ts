import { evaluateStory, namesInText, sentenceCaseHeadline, selectFive, type Candidate, type GateContext, type GateStory } from './gates.ts'
import type { DraftStory } from './types.ts'

export const toGateStory = (s: DraftStory): GateStory => ({
  headline: s.headline,
  summary: s.summary,
  category: s.category,
  sourceName: s.source_name,
  sourceUrl: s.source_url,
  sourcePublishedAt: s.source_published_at,
  sourceMaterial: s.source_material ?? null,
  aiRationale: s.ai_rationale,
})

/**
 * Put every drafted story through the deterministic gates and build the final
 * lineup: the first five that pass become the edition (in order), the next
 * three that pass wait as backups, and everything else is stored as rejected
 * with the reasons, so an editor can see exactly what was turned away and why.
 */
export function applyGates(input: DraftStory[], ctx: GateContext, maxRejectedKept = 6): { stories: DraftStory[]; accepted: number; rejected: number } {
  // Title Case headlines are normalised to sentence case first, using the source's own capitalisation as the guide to names.
  const stories = input.map((s) => ({ ...s, headline: sentenceCaseHeadline(s.headline, namesInText(s.summary, s.source_material ?? '')) }))
  const ordered = [...stories].sort((a, b) => (a.role === b.role ? (a.position ?? 99) - (b.position ?? 99) : a.role === 'primary' ? -1 : 1))
  const candidates: Candidate<DraftStory>[] = ordered.map((item) => ({ item, headline: item.headline, sourceUrl: item.source_url, result: evaluateStory(toGateStory(item), ctx) }))
  const { chosen, rejected } = selectFive(candidates, 8)

  const kept = chosen.map((s, i) => ({ ...s, role: i < 5 ? ('primary' as const) : ('backup' as const), position: i < 5 ? i + 1 : i - 4, rejected_reason: null }))
  const turnedAway = rejected.slice(0, maxRejectedKept).map(({ item, reasons }) => ({ ...item, role: 'rejected' as const, position: null, rejected_reason: reasons.join(' ').slice(0, 900), image_url: null, image_candidates: [] }))
  return { stories: [...kept, ...turnedAway], accepted: chosen.length, rejected: rejected.length }
}
