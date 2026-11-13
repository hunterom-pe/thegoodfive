import { useEffect, useLayoutEffect, useRef, type HTMLAttributes } from 'react'

/**
 * One-shot scroll reveals, driven by a single shared IntersectionObserver
 * and plain CSS transitions on opacity and transform (see index.css). There
 * is no scroll listener and no animation library.
 *
 *   text     children fade up in sequence: label, headline, summary, source
 *   media    a photo fades in with a slight scale; [data-sq] squares drift in
 *   closing  the back cover: five squares in turn, then the headline
 *
 * Content is only ever hidden after this component has mounted and flagged
 * <html> with `rv-on`, and never when the visitor prefers reduced motion.
 */
export type RevealVariant = 'text' | 'media' | 'closing'

const handlers = new Map<Element, () => void>()
let observer: IntersectionObserver | null = null

function watch(el: Element, reveal: () => void) {
  if (typeof IntersectionObserver === 'undefined') return reveal()
  observer ??= new IntersectionObserver(
    (entries) => {
      const done = (el: Element) => {
        handlers.get(el)?.()
        handlers.delete(el)
        observer?.unobserve(el)
      }
      let triggered = false
      for (const entry of entries) {
        if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) {
          triggered = true
          done(entry.target)
        }
      }
      // A fast flick or an in-page jump can carry us past blocks without the observer ever
      // seeing them cross the screen. Reveal everything already behind us (off screen, so
      // silently) so that scrolling back up never meets a hole.
      if (triggered) for (const el of [...handlers.keys()]) if (el.getBoundingClientRect().bottom < 0) done(el)
    },
    { rootMargin: '0px 0px -6% 0px' },
  )
  handlers.set(el, reveal)
  observer.observe(el)
}

export function Reveal({ children, className = '', variant = 'text', ...rest }: HTMLAttributes<HTMLDivElement> & { variant?: RevealVariant }) {
  const ref = useRef<HTMLDivElement>(null)

  // Before first paint, so there is never a flash of visible-then-hidden content.
  useLayoutEffect(() => {
    document.documentElement.classList.add('rv-on')
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    watch(el, () => el.classList.add('is-visible'))
    return () => {
      handlers.delete(el)
      observer?.unobserve(el)
    }
  }, [])

  return (
    <div ref={ref} className={`rv-group rv-${variant} ${className}`} {...rest}>
      {children}
    </div>
  )
}
