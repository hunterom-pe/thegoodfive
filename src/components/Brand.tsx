import { LOGO_PATH, LOGO_VIEWBOX } from './logoPath'

/** Shared page gutter and measure. Mobile first: 20px gutters at 390px. */
export const wrap = 'mx-auto w-full max-w-[72rem] px-5 sm:px-8 lg:px-12'

/**
 * The mark: a single Fraunces Bold "G", drawn as a vector outline (see
 * logoPath.ts) so it never waits for the font. It carries its own off-white
 * square, matching the favicon and app icons.
 */
export function BrandMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`} aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width={LOGO_VIEWBOX} height={LOGO_VIEWBOX} fill="#FAFAF7" />
      <path d={LOGO_PATH} fill="#304D3C" />
    </svg>
  )
}

const LIGHT = ['bg-forest', 'bg-sage', 'bg-earth', 'bg-blush', 'bg-forest']
const DARK = ['bg-chalk', 'bg-sage', 'bg-blush', 'bg-[#b8977e]', 'bg-chalk']

/** Five small squares in a row: the daily five, as a signature. */
export function FiveSquares({ size = 10, gap = 5, onDark = false, className = '' }: { size?: number; gap?: number; onDark?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" data-five className={`inline-flex ${className}`} style={{ gap }}>
      {(onDark ? DARK : LIGHT).map((color, i) => (
        <span key={i} className={color} style={{ width: size, height: size }} />
      ))}
    </span>
  )
}

export function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className={className}>
      <path d="M2.5 9.5 9.5 2.5M4 2.5h5.5V8" strokeLinecap="square" />
    </svg>
  )
}
