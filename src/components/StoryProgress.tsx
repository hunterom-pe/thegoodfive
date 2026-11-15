import { useReadingPosition } from '../lib/readingPosition'

/**
 * Five squares in the header that fill as you read, each a link to its story. Shown on mid-width screens
 * (1024-1439px); narrower screens get the story strip and wider ones the contents rail instead (index.css).
 */
export function StoryProgress({ count = 5 }: { count?: number }) {
  const { story: reached } = useReadingPosition()
  const numbers = Array.from({ length: count }, (_, i) => i + 1)
  return (
    <nav aria-label="Stories in this edition" className="progress-links items-center">
      {numbers.map((n) => (
        <a key={n} href={`#story-${n}`} aria-label={`Story ${n} of ${count}`} aria-current={n === reached ? 'location' : undefined} className="grid h-11 w-6 place-items-center">
          <span className={`size-2 border border-forest transition-colors duration-300 ${n <= reached ? 'bg-forest' : 'bg-transparent'} ${n === reached ? 'scale-125' : ''}`} />
        </a>
      ))}
    </nav>
  )
}
