import { useEffect, type ReactNode } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { BrandMark } from '../components/Brand'
import { demoStore } from '../data/demoStore'
import { EditionEditor } from './EditionEditor'
import { EditionPreview } from './EditionPreview'
import { EditorDashboard } from './EditorDashboard'
import { LoginForm } from './LoginForm'
import { signOut, useEditorAuth } from './useEditorAuth'

function Shell({ children, email, demo }: { children: ReactNode; email?: string; demo: boolean }) {
  return (
    <div className="min-h-dvh bg-[#f5f5f0]">
      <header className="border-b border-line bg-chalk">
        <div className="mx-auto flex h-14 max-w-[52rem] items-center justify-between gap-4 px-4 sm:px-8">
          <Link to="/editor" className="flex h-11 items-center gap-2.5">
            <BrandMark size={20} />
            <span className="font-display text-[1.0625rem] font-[480] tracking-[-0.02em] text-forest">The Good Five</span>
            <span className="label bg-forest px-1.5 py-1 text-[0.5625rem] text-chalk">Editor</span>
          </Link>
          <nav className="flex items-center gap-5">
            <Link to="/" className="label flex h-11 items-center text-ink/60 hover:text-forest">
              View site
            </Link>
            {!demo && (
              <button type="button" className="label flex h-11 items-center text-ink/60 hover:text-forest" onClick={() => void signOut()} title={email}>
                Sign out
              </button>
            )}
          </nav>
        </div>
      </header>
      {demo && (
        <div className="bg-mist">
          <p className="mx-auto flex max-w-[52rem] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[0.75rem] leading-snug text-ink/75 sm:px-8">
            <span>Demo mode: Supabase isn’t configured, so there’s no sign-in and your changes stay in this browser.</span>
            <button
              type="button"
              className="link-quiet font-semibold text-forest"
              onClick={() => {
                demoStore.reset()
                window.location.assign('/editor')
              }}
            >
              Reset sample data
            </button>
          </p>
        </div>
      )}
      <main className="mx-auto max-w-[52rem] px-4 py-8 sm:px-8 sm:py-12">{children}</main>
    </div>
  )
}

export default function EditorApp() {
  const auth = useEditorAuth()

  // Belt and braces alongside robots.txt and the X-Robots-Tag header.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.append(meta)
    return () => meta.remove()
  }, [])

  if (auth.status === 'checking') return <p className="label p-8 text-earth">Checking your sign-in…</p>
  if (auth.status === 'signed-out') return <LoginForm />
  if (auth.status === 'forbidden') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[24rem] flex-col justify-center px-5">
        <h1 className="display text-[2rem]">This account isn’t an editor.</h1>
        <p className="mt-3 text-[0.9375rem] text-ink/70">You’re signed in as {auth.email}, which doesn’t have access to the editorial desk.</p>
        <button type="button" className="btn mt-6 self-start" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
    )
  }

  const demo = auth.status === 'demo'
  const email = auth.status === 'editor' ? auth.email : undefined
  return (
    <Routes>
      <Route path=":id/preview" element={<EditionPreview />} />
      <Route
        path="*"
        element={
          <Shell demo={demo} email={email}>
            <Routes>
              <Route index element={<EditorDashboard />} />
              <Route path=":id" element={<EditionEditor />} />
            </Routes>
          </Shell>
        }
      />
    </Routes>
  )
}
