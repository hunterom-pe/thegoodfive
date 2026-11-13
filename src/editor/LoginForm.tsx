import { useState, type FormEvent } from 'react'
import { BrandMark } from '../components/Brand'
import { supabase } from './supabaseClient'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[24rem] flex-col justify-center px-5 py-12">
      <BrandMark size={28} />
      <h1 className="display mt-6 text-[2.25rem]">Editor sign-in</h1>
      <p className="mt-2 text-[0.9375rem] text-ink/70">The Good Five editorial desk. Readers don’t need an account.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block">
          <span className="label text-earth">Email</span>
          <input type="email" required autoComplete="username" className="field mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label text-earth">Password</span>
          <input type="password" required autoComplete="current-password" className="field mt-1.5" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="border-l-2 border-earth pl-3 text-[0.875rem] text-earth">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-solid w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
