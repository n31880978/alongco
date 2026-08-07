import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { auth } from '@clerk/nextjs/server'
import type { Database } from './types'
import { supabasePublicKey } from './config'

/**
 * Supabase acting as the signed-in CUSTOMER, authenticated by Clerk.
 *
 * Supabase's third-party auth integration takes a token supplier rather than
 * managing a session of its own: the Clerk session token is sent as the bearer,
 * Supabase verifies it against Clerk's JWKS, and RLS then sees the Clerk user id
 * as the `sub` claim. ac_auth_subject() reads it as text, which is the whole
 * point of migration 0013 — Clerk ids are not uuids.
 *
 * Two things follow from using `accessToken`, both deliberate:
 *
 *   · No cookie handling. Clerk owns the session; there is nothing for Supabase
 *     to store, refresh or rotate, so this uses the plain supabase-js client
 *     rather than the SSR one.
 *   · `supabase.auth.*` must never be called on this client. Sign-in, sign-out
 *     and user lookup all belong to Clerk. Calling them here would operate on a
 *     Supabase session that does not exist.
 *
 * Admin code must NOT use this. Admins are still Supabase email + password
 * (lib/supabase/server.ts), which is what keeps the two credential classes
 * genuinely separate under CLAUDE.md §9.
 */
export function createCustomerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = supabasePublicKey()
  if (!url || !key) {
    throw new Error('Supabase URL and publishable key must be set')
  }

  return createSupabaseClient<Database>(url, key, {
    async accessToken() {
      // Null when signed out, which leaves the request anonymous rather than
      // failing — public reads still work, and RLS denies everything else.
      const { getToken } = await auth()
      return (await getToken()) ?? null
    },
  })
}
