import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'
import { supabasePublicKey } from './config'

/**
 * Anonymous, cookie-free client for public reads.
 *
 * Reading cookies would opt the landing, browse and profile pages out of static
 * rendering, and those are the pages the Lighthouse target applies to. Nothing
 * here is user-specific: RLS as `anon` is exactly the visibility a logged-out
 * visitor should have, so a signed-in customer sees the same catalogue.
 *
 * Anything that depends on who is asking must use lib/supabase/server.ts.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = supabasePublicKey()
  if (!url || !publicKey) return null

  return createSupabaseClient<Database>(url, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
