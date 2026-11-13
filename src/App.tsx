import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PageLoading } from './components/PageStates'
import { AboutPage } from './pages/AboutPage'
import { ArchivePage } from './pages/ArchivePage'
import { EditionPage } from './pages/EditionPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'

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
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-forest focus:px-4 focus:py-3 focus:text-chalk">
        Skip to the stories
      </a>
      <div id="main" className="contents">
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
      </div>
    </BrowserRouter>
  )
}
