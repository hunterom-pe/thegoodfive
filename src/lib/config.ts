export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Without Supabase credentials the site runs on bundled sample content so it
 * stays complete and testable. Demo mode is always labelled in the interface.
 */
export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY
