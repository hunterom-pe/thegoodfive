import { createClient } from '@supabase/supabase-js'
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/config'

/** Only ever imported from the lazily loaded editor chunk. Null in demo mode. */
export const supabase = IS_DEMO ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
