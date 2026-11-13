/** Shared page gutter and measure. Mobile first: 20px gutters at 390px. */
export const wrap = 'mx-auto w-full max-w-[72rem] px-5 sm:px-8 lg:px-12'

/**
 * The mark: five squares set like the five on a die. Four hold the corners,
 * one blush square sits in the middle — the small good thing at the centre.
 */
export function BrandMark({ size = 22, onDark = false, className = '' }: { size?: number; onDark?: boolean; className?: string }) {
  const corner = onDark ? '#FAFAF7' : '#304D3C'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect x="0" y="0" width="8" height="8" fill={corner} />
      <rect x="16" y="0" width="8" height="8" fill={corner} />
      <rect x="8" y="8" width="8" height="8" fill="#EBC9CC" />
      <rect x="0" y="16" width="8" height="8" fill={corner} />
      <rect x="16" y="16" width="8" height="8" fill={corner} />
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
