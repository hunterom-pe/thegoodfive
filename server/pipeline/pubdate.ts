/**
 * Publication dates, kept apart from discovery times.
 *
 * A publisher's date has two parts that must not be confused: the instant it was published (used for freshness)
 * and the calendar day the publisher itself prints (what a reader compares against the article). ScienceDaily
 * stamps an item "Sun, 15 Nov 2026 22:51:01 EST": that is 16 November in UTC, but the page says November 15.
 * Showing the UTC day would disagree with the publisher, and subtracting a day would be wrong for every
 * other zone, so the printed day is read from the publisher's own text and kept beside the instant.
 */
export interface Publication {
  /** The instant, as an ISO string. */
  at: string
  /** The publisher's own calendar day, YYYY-MM-DD. */
  on: string
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
const valid = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/** Read a date from a feed field or a page's metadata. Null when it names no real day. */
export function parsePublication(raw: string | null | undefined): Publication | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  let on: string | null = null
  let dateOnly = false
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text)
  if (iso) {
    on = iso[1]
    dateOnly = text.length === 10
  } else {
    const rfc = /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})\b/.exec(text)
    const month = rfc && MONTHS[rfc[2].toLowerCase()]
    if (rfc && month) on = `${rfc[3]}-${month}-${rfc[1].padStart(2, '0')}`
  }
  if (!on || !valid(on)) return null
  // A bare date, or a time with no zone, names no exact instant: use midday UTC of that day, which is within
  // twelve hours of any real instant on it and never crosses into a different calendar day for freshness.
  const instant = dateOnly ? Date.parse(`${on}T12:00:00Z`) : Date.parse(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return { at: new Date(Number.isNaN(instant) ? Date.parse(`${on}T12:00:00Z`) : instant).toISOString(), on }
}
