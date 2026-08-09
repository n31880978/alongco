import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy-session'

/**
 * Host routing + Supabase session refresh for the admin surface.
 *
 * No Clerk. Customer-facing pages are fully public — the booking form collects
 * identity (name, email, phone) and the ticket is the proof of booking.
 *
 * Admin routing:
 *   ADMIN_HOST  → rewrite bare path to /admin/* and refresh Supabase cookie
 *   localhost   → /admin/* prefix is the switch (no second hostname available)
 *   public host → /admin/* returns hard 404 (CLAUDE.md §9: refuse, don't redirect)
 */

function isAdminRequest(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase()
  const adminHost = (process.env.ADMIN_HOST ?? 'admin.alongco.com')
    .split(':')[0]
    .toLowerCase()
  const { pathname } = request.nextUrl
  const isAdminHost = host === adminHost
  const isLocal = host === 'localhost' || host === '127.0.0.1'

  return {
    isAdminHost,
    isLocal,
    pathname,
    targetsAdmin: isAdminHost || pathname.startsWith('/admin'),
  }
}

export async function middleware(request: NextRequest) {
  const { isAdminHost, isLocal, pathname, targetsAdmin } = isAdminRequest(request)

  // Hard 404 on the public host for any /admin/* path.
  if (!isAdminHost && !isLocal && pathname.startsWith('/admin')) {
    return new NextResponse(null, { status: 404 })
  }

  // ADMIN_HOST: rewrite bare path → /admin/* and refresh Supabase cookie.
  if (isAdminHost && !pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone()
    url.pathname = `/admin${pathname === '/' ? '' : pathname}`
    return updateSession(request, url)
  }

  // Admin prefix (localhost or admin host): just refresh the cookie.
  if (targetsAdmin) {
    return updateSession(request)
  }

  // All public/customer routes: no session, just pass through.
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Webhooks and cron
     * carry their own signature/secret verification and must not have cookies
     * rewritten under them.
     */
    '/((?!_next/static|_next/image|api/webhooks|api/cron|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
