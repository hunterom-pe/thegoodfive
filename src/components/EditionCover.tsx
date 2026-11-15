import { coverLayout } from '../lib/cards'
import { formatLong } from '../lib/dates'
import type { Category } from '../lib/types'

/**
 * An edition's cover: its five stories as five squares, coloured by category and arranged by a generator seeded
 * with the date, so each edition has its own recognisable composition, the same on every visit and device.
 * Plain SVG: tiny, sharp at any size, no image to download. Decorative unless given a label.
 */
export function EditionCover({ date, categories, className = '', label, framed = false }: { date: string; categories: Category[]; className?: string; label?: boolean; framed?: boolean }) {
  const squares = coverLayout(date, categories)
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label ? `Cover of the edition for ${formatLong(date)}` : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-cover={date}
    >
      {framed && <rect x="0.5" y="0.5" width="99" height="99" fill="none" stroke="currentColor" strokeOpacity="0.25" />}
      {squares.map((s) => (
        <rect key={s.story} x={s.x} y={s.y} width={s.size} height={s.size} fill={s.color} />
      ))}
    </svg>
  )
}
