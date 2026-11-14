import { useEffect, useState } from 'react'

/**
 * Five squares in the header that fill as you read. There are only ever
 * five, so you always know how close you are to being done.
 */
export function StoryProgress({ count = 5 }: { count?: number }) {
  const [reached, setReached] = useState(0)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const line = window.innerHeight * 0.55
      let n = 0
      document.querySelectorAll<HTMLElement>('[data-story]').forEach((el) => {
        if (el.getBoundingClientRect().top <= line) n = Math.max(n, Number(el.dataset.story))
      })
      setReached(n)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const square = (n: number) => (
    <span className={`size-2 border border-forest transition-colors duration-300 ${n <= reached ? 'bg-forest' : 'bg-transparent'} ${n === reached ? 'scale-125' : ''}`} />
  )
  const numbers = Array.from({ length: count }, (_, i) => i + 1)
  return (
    <>
      {/* 400px and wider: each square is a 24px-wide link to its story (WCAG 2.2 target size). */}
      <nav aria-label="Stories in this edition" className="progress-links items-center">
        {numbers.map((n) => (
          <a key={n} href={`#story-${n}`} aria-label={`Story ${n} of ${count}`} aria-current={n === reached ? 'true' : undefined} className="grid h-11 w-6 place-items-center">
            {square(n)}
          </a>
        ))}
      </nav>
      {/* Narrower phones: the same five squares as a reading-progress indicator, without tap targets that would be too small. */}
      <div role="img" aria-label={`Reading progress: story ${Math.max(reached, 1)} of ${count}`} className="progress-dots items-center gap-2">
        {numbers.map((n) => (
          <span key={n} className="grid w-2 place-items-center">
            {square(n)}
          </span>
        ))}
      </div>
    </>
  )
}
