import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabasePublicKey } from './config'

type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Refreshes the Supabase session cookie on every request so server components
 * never see a stale token. Called from proxy.ts.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = supabasePublicKey()
  // Env not wired yet (or a preview without secrets) — pass the request through
  // rather than throwing a 500 on every route.
  if (!url || !publicKey) return response

  const supabase = createServerClient(url, publicKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Do not remove: this call is what performs the refresh.
  await supabase.auth.getUser()

  return response
}
