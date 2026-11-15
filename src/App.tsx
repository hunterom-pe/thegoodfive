import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PageLoading } from './components/PageStates'
import { whenAvailable } from './lib/hashTarget'
import { HomePage } from './pages/HomePage'

// The home page ships in the main bundle; the rest load when first visited.
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })))
const ArchivePage = lazy(() => import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage })))
const EditionPage = lazy(() => import('./pages/EditionPage').then((m) => ({ default: m.EditionPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))

// The editor (and the Supabase auth client it needs) is a separate chunk
// that readers never download.
const EditorApp = lazy(() => import('./editor/EditorApp'))

/**
 * New page: start at the top, or at the #section the link asked for. A section may not exist yet
 * (the page chunk and the edition load after the first render), so wait for it rather than trying
 * once. Cold loads jump instantly; links within the page scroll smoothly. Stops if the reader
 * starts scrolling, so we never fight them.
 */
let firstNavigation = true
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      firstNavigation = false
      return
    }
    const id = decodeURIComponent(hash.slice(1))
    const cold = firstNavigation
    firstNavigation = false
    const behavior: ScrollBehavior = cold ? 'instant' : 'auto'
    const find = () => document.getElementById(id)
    const wait = whenAvailable({
      find,
      subscribe: (onChange) => {
        const observer = new MutationObserver(onChange)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => observer.disconnect()
      },
      timeoutMs: 10_000,
    })
    let interrupted = false
    const stop = () => {
      interrupted = true
      wait.cancel()
    }
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    events.forEach((e) => window.addEventListener(e, stop, { passive: true, once: true }))
    const timers: ReturnType<typeof setTimeout>[] = []
    void wait.result.then((el) => {
      if (!el || interrupted) return
      el.scrollIntoView({ behavior })
      // Move keyboard focus to the target so Tab continues from there, without scrolling again.
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
      // Images, fonts and reveal animations settle just after mounting and can nudge the layout: align once more.
      for (const ms of [350, 1200]) timers.push(setTimeout(() => !interrupted && find()?.scrollIntoView({ behavior: 'instant' }), ms))
    })
    return () => {
      wait.cancel()
      timers.forEach(clearTimeout)
      events.forEach((e) => window.removeEventListener(e, stop))
    }
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <a
        href="#main"
        onClick={(e) => {
          // <main> isn't focusable by default. Make it so, focus it, and scroll to it: a bare #hash would leave focus behind.
          const main = document.querySelector('main')
          if (!main) return
          e.preventDefault()
          main.setAttribute('tabindex', '-1')
          main.focus({ preventScroll: true })
          main.scrollIntoView({ block: 'start' })
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:bg-forest focus:px-4 focus:py-3 focus:text-chalk"
      >
        Skip to the stories
      </a>
      <div id="main" className="contents">
        <Suspense fallback={<PageLoading label="Opening…" />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/edition/:date" element={<EditionPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route
            path="/editor/*"
            element={
              <Suspense fallback={<PageLoading label="Opening the editor…" />}>
                <EditorApp />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  )
}
