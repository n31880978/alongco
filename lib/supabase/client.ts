import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'
import { supabasePublicKey } from './config'

/** Browser client. Anon key only — RLS is the boundary. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublicKey()!,
  )
}
