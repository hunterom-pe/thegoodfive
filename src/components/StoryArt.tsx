import { CATEGORIES } from '../lib/categories'
import type { Category } from '../lib/types'

/**
 * The plate that stands in when a story has no photograph we are entitled
 * to show. One fixed composition of squares per category, so a missing
 * picture reads as a deliberate design decision rather than a gap.
 */
type Square = [x: number, y: number, size: number, fill: string]

const forest = '#304D3C'
const sage = '#A5B49A'
const earth = '#80634D'
const blush = '#EBC9CC'
const chalk = '#FAFAF7'

const PLATES: Record<Category, { bg: string; ink: string; squares: Square[] }> = {
  nature: { bg: sage, ink: forest, squares: [[14, 36, 46, forest], [50, 18, 30, chalk], [70, 62, 13, blush]] },
  health: { bg: '#EEF0E9', ink: forest, squares: [[30, 20, 44, sage], [16, 52, 28, forest], [66, 60, 13, blush]] },
  science: { bg: forest, ink: chalk, squares: [[18, 20, 38, sage], [48, 44, 32, chalk], [30, 68, 12, blush]] },
  humanity: { bg: '#EAE1D8', ink: forest, squares: [[16, 22, 40, earth], [46, 44, 36, forest], [70, 20, 13, blush]] },
  progress: {
    bg: '#EFEEE6',
    ink: forest,
    squares: [[12, 68, 15, forest], [27, 53, 15, sage], [42, 38, 15, earth], [57, 23, 15, blush], [72, 8, 15, forest]],
  },
}

export function StoryArt({ category }: { category: Category }) {
  const plate = PLATES[category]
  return (
    <div className="relative size-full" style={{ background: plate.bg }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden="true">
        {plate.squares.map(([x, y, size, fill], i) => (
          <rect key={i} x={x} y={y} width={size} height={size} fill={fill} />
        ))}
      </svg>
      <span className="label absolute bottom-3 left-3" style={{ color: plate.ink }}>
        {CATEGORIES[category].short}
      </span>
    </div>
  )
}
