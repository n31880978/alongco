import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabasePublicKey } from './config'

type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Refreshes the Supabase session cookie on every request so server components
 * never see a stale token. Called from proxy.ts.
 *
 * `rewriteTo` exists because the admin host rewrites every bare path into the
 * `/admin/*` route group. That rewrite has to happen *and* the session has to
 * refresh, and the response can only be built once — so the rewrite target is
 * passed in here rather than the caller returning its own response and dropping
 * the refreshed cookies on the floor.
 *
 * Getting this wrong is invisible for about an hour: the access token simply
 * stops being renewed, and an operator is signed out mid-shift.
 */
export async function updateSession(request: NextRequest, rewriteTo?: URL) {
  const build = () =>
    rewriteTo
      ? NextResponse.rewrite(rewriteTo, { request })
      : NextResponse.next({ request })

  let response = build()

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
        response = build()
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
