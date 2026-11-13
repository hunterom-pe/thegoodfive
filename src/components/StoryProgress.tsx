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

  return (
    <nav aria-label="Stories in this edition" className="hidden items-center xs:flex">
      {Array.from({ length: count }, (_, i) => {
        const n = i + 1
        const filled = n <= reached
        return (
          <a
            key={n}
            href={`#story-${n}`}
            aria-label={`Story ${n} of ${count}`}
            aria-current={n === reached ? 'true' : undefined}
            className="grid h-11 w-[1.125rem] place-items-center"
          >
            <span
              className={`size-2 border border-forest transition-colors duration-300 ${filled ? 'bg-forest' : 'bg-transparent'} ${n === reached ? 'scale-125' : ''}`}
            />
          </a>
        )
      })}
    </nav>
  )
}
