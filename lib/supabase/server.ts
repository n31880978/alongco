import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from './types'
import { supabasePublicKey } from './config'

type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Server client, anon key, acting as the signed-in user. Everything it can read
 * is what RLS lets that user read. Use this for anything customer-facing.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublicKey()!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component; the proxy refreshes the session
            // instead. Safe to ignore.
          }
        },
      },
    },
  )
}
