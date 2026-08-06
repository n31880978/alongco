import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy-session'

/**
 * Host routing + session refresh.
 *
 * The route lives in `app/(admin)/admin/*`. On ADMIN_HOST, a bare path is
 * rewritten into that internal prefix, so `admin.alongco.com/bookings` and
 * `localhost:3000/admin/bookings` resolve to the same route. The `/admin`
 * segment is never visible to a production admin visitor.
 *
 * On the public host, `/admin/*` is a hard 404 — CLAUDE.md §9: refuse, do not
 * redirect to a login that would accept a customer.
 */
export async function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase()
  const adminHost = (process.env.ADMIN_HOST ?? 'admin.alongco.com')
    .split(':')[0]
    .toLowerCase()
  const { pathname } = request.nextUrl

  const isAdminHost = host === adminHost
  // Localhost has no second hostname to route on, so the prefix is the switch.
  const isLocal = host === 'localhost' || host === '127.0.0.1'

  if (!isAdminHost && !isLocal && pathname.startsWith('/admin')) {
    return new NextResponse(null, { status: 404 })
  }

  if (isAdminHost && !pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone()
    url.pathname = `/admin${pathname === '/' ? '' : pathname}`
    // Rewrite AND refresh. Returning a bare rewrite here would skip the session
    // refresh on every canonical admin URL, so an operator's token would expire
    // about an hour into a shift and sign them out.
    return updateSession(request, url)
  }

  // Refreshes the Supabase auth cookie so server components see a live session.
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Webhooks and cron
     * are excluded — they carry their own signature/secret verification and must
     * not have cookies rewritten under them.
     */
    '/((?!_next/static|_next/image|api/webhooks|api/cron|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
