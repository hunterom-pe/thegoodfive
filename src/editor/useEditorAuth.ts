import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export type AuthState =
  | { status: 'checking' }
  | { status: 'signed-out' }
  /** Signed in, but not listed in the `editors` table. */
  | { status: 'forbidden'; email: string }
  | { status: 'editor'; email: string }
  /** No Supabase configured: sample data only, nothing to protect. */
  | { status: 'demo' }

/**
 * Who is using /editor. This only decides what to draw: the database
 * independently refuses every read and write from anyone who is not an editor.
 */
export function useEditorAuth(): AuthState {
  const [state, setState] = useState<AuthState>(supabase ? { status: 'checking' } : { status: 'demo' })

  useEffect(() => {
    if (!supabase) return
    let live = true
    const resolve = async (email: string | undefined, signedIn: boolean) => {
      if (!signedIn) return live && setState({ status: 'signed-out' })
      const { data, error } = await supabase!.rpc('is_editor')
      if (live) setState(!error && data === true ? { status: 'editor', email: email ?? '' } : { status: 'forbidden', email: email ?? '' })
    }
    supabase.auth.getSession().then(({ data }) => resolve(data.session?.user.email, Boolean(data.session)))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refreshes don't change who you are; skip the extra round trip.
      if (event === 'TOKEN_REFRESHED') return
      // Defer: Supabase warns against calling its API inside this callback.
      setTimeout(() => resolve(session?.user.email, Boolean(session)), 0)
    })
    return () => {
      live = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}

export const signOut = () => supabase?.auth.signOut()
