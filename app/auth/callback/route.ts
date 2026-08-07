import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_VERSION } from '@/lib/booking/terms'

/**
 * Where the confirmation link in her email lands.
 *
 * Supabase's stock template sends {{ .ConfirmationURL }}, which bounces through
 * Supabase's own verify endpoint and then here with `?code=`. @supabase/ssr
 * uses the PKCE flow, so exchanging that code needs the `code_verifier` cookie
 * that was set on the browser which submitted the sign-in form.
 *
 * That has a consequence worth stating plainly, because it is the most likely
 * way a real customer gets stuck: if she opens the link inside the Gmail app's
 * in-app browser rather than the browser she started in, the verifier cookie is
 * not there and the exchange fails. That is not recoverable here — the fix is
 * to send her back to sign-in with an explanation that names the actual
 * problem, instead of a generic error she cannot act on.
 *
 * This route is also the only place a customer record gets created, so a
 * confirmed link always produces an account (PRD §6.3).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNext(url.searchParams.get('next'))

  // Supabase reports its own refusals here — an expired or already-used link.
  const providerError = url.searchParams.get('error_description')
  if (providerError) {
    return redirectToSignIn(request, 'expired', next)
  }

  if (!code) {
    return redirectToSignIn(request, 'missing', next)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Overwhelmingly this is the cross-browser case described above.
    return redirectToSignIn(request, 'wrong_browser', next)
  }

  // Creates the customer row on first confirmation, adopting an existing record
  // if this address has booked before.
  const { error: customerError } = await supabase.rpc('ac_ensure_customer', {
    p_consent_version: CONSENT_VERSION,
  })
  if (customerError) {
    return redirectToSignIn(request, 'account', next)
  }

  return NextResponse.redirect(new URL(next, request.url))
}

type Reason = 'expired' | 'missing' | 'wrong_browser' | 'account'

function redirectToSignIn(request: NextRequest, reason: Reason, next: string) {
  const target = new URL('/sign-in', request.url)
  target.searchParams.set('error', reason)
  if (next !== '/bookings') target.searchParams.set('next', next)
  return NextResponse.redirect(target)
}

/**
 * Only same-origin paths. An open redirect on the confirmation step hands a
 * freshly authenticated customer straight to whoever crafted the link.
 */
function safeNext(next: string | null): string {
  if (!next) return '/bookings'
  if (!next.startsWith('/') || next.startsWith('//')) return '/bookings'
  return next
}
