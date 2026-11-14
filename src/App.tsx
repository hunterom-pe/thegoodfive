import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PageLoading } from './components/PageStates'
import { HomePage } from './pages/HomePage'

// The home page ships in the main bundle; the rest load when first visited.
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })))
const ArchivePage = lazy(() => import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage })))
const EditionPage = lazy(() => import('./pages/EditionPage').then((m) => ({ default: m.EditionPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))

// The editor (and the Supabase auth client it needs) is a separate chunk
// that readers never download.
const EditorApp = lazy(() => import('./editor/EditorApp'))

/** New page: start at the top, or at the #section the link asked for. */
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      // Wait a frame so the target section has rendered.
      requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView())
    } else {
      window.scrollTo(0, 0)
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
