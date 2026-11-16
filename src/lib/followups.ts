import type { PublicStory } from './types'

/**
 * Approved "What happened next?" links, as readers see them. The database view public_followups already returns
 * only approved links whose two stories are both published and not in the future; this turns its rows into
 * per-story links and, defensively, drops anything malformed or running backwards in time.
 */
export interface FollowUpRow {
  id: string
  explanation: string
  source_url: string
  earlier_story_id: string
  earlier_date: string
  earlier_position: number
  earlier_headline: string
  later_story_id: string
  later_date: string
  later_position: number
  later_headline: string
}

export interface FollowUp {
  id: string
  /** On the newer story: "An update to…" the earlier one. On the earlier story: "What happened next?" */
  kind: 'update-to' | 'what-next'
  date: string
  position: number
  headline: string
  explanation: string
  sourceUrl: string
}

const valid = (r: FollowUpRow) =>
  typeof r?.id === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(r.earlier_date) &&
  /^\d{4}-\d{2}-\d{2}$/.test(r.later_date) &&
  r.earlier_date < r.later_date &&
  r.earlier_story_id !== r.later_story_id &&
  Number.isInteger(r.earlier_position) && r.earlier_position >= 1 && r.earlier_position <= 5 &&
  Number.isInteger(r.later_position) && r.later_position >= 1 && r.later_position <= 5 &&
  /^https:\/\//i.test(r.source_url)

export function followUpsFor(storyId: string, rows: FollowUpRow[]): FollowUp[] {
  const out: FollowUp[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!valid(r) || seen.has(r.id)) continue
    if (r.later_story_id === storyId) out.push({ id: r.id, kind: 'update-to', date: r.earlier_date, position: r.earlier_position, headline: r.earlier_headline, explanation: r.explanation, sourceUrl: r.source_url })
    else if (r.earlier_story_id === storyId) out.push({ id: r.id, kind: 'what-next', date: r.later_date, position: r.later_position, headline: r.later_headline, explanation: r.explanation, sourceUrl: r.source_url })
    else continue
    seen.add(r.id)
  }
  // Updates first, then the newest development first.
  return out.sort((a, b) => (a.kind === b.kind ? b.date.localeCompare(a.date) : a.kind === 'update-to' ? -1 : 1))
}

export function attachFollowUps(stories: PublicStory[], rows: FollowUpRow[]): PublicStory[] {
  return stories.map((s) => {
    const followUps = followUpsFor(s.id, rows)
    return followUps.length ? { ...s, followUps } : s
  })
}
