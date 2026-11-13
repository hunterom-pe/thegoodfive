/**
 * Pure lineup arithmetic for an edition: which five stories run, in what
 * order, and which wait as backups. Anything in neither list is rejected.
 */
export interface Lineup {
  primary: string[]
  backup: string[]
}

export const EDITION_SIZE = 5

export function move(lineup: Lineup, id: string, direction: -1 | 1): Lineup {
  const from = lineup.primary.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= lineup.primary.length) return lineup
  const primary = [...lineup.primary]
  ;[primary[from], primary[to]] = [primary[to], primary[from]]
  return { ...lineup, primary }
}

/** The backup takes the story's slot; the story takes the backup's place on the bench. */
export function swapWithBackup(lineup: Lineup, primaryId: string, backupId: string): Lineup {
  const p = lineup.primary.indexOf(primaryId)
  const b = lineup.backup.indexOf(backupId)
  if (p < 0 || b < 0) return lineup
  const primary = [...lineup.primary]
  const backup = [...lineup.backup]
  primary[p] = backupId
  backup[b] = primaryId
  return { primary, backup }
}

/** Rejecting one of the five pulls the first backup into its slot so the edition stays whole. */
export function reject(lineup: Lineup, id: string): Lineup {
  const p = lineup.primary.indexOf(id)
  if (p >= 0) {
    const [replacement, ...rest] = lineup.backup
    const primary = [...lineup.primary]
    if (replacement) primary[p] = replacement
    else primary.splice(p, 1)
    return { primary, backup: replacement ? rest : [] }
  }
  return { ...lineup, backup: lineup.backup.filter((b) => b !== id) }
}

/** A rejected story comes back as a backup, never straight into the five. */
export function restore(lineup: Lineup, id: string): Lineup {
  if (lineup.primary.includes(id) || lineup.backup.includes(id)) return lineup
  return { ...lineup, backup: [...lineup.backup, id] }
}

/** Fill an empty slot from the bench. */
export function promote(lineup: Lineup, backupId: string): Lineup {
  if (lineup.primary.length >= EDITION_SIZE || !lineup.backup.includes(backupId)) return lineup
  return { primary: [...lineup.primary, backupId], backup: lineup.backup.filter((b) => b !== backupId) }
}
