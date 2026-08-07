'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { checkOtpRateLimit } from '@/lib/auth/rate-limit'
import { emailSchema } from '@/lib/auth/email'

/**
 * Email confirmation sign-in.
 *
 * She enters an address, Supabase emails a confirmation link, and clicking it
 * lands on /auth/callback which exchanges the code and creates her customer
 * record. Nothing is typed back into this app — there is no code to enter,
 * because Supabase's stock template does not carry one (see lib/auth/email.ts).
 *
 * Admin sign-in is a separate credential class entirely (email + password), so
 * nothing here can produce a session that reaches the operations surface.
 */

export type SignInState = {
  error?: string
  email?: string
  sent?: boolean
}

const schema = z.object({
  email: emailSchema,
  next: z.string().optional(),
})

export async function requestSignInLink(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    next: formData.get('next'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid email address.' }
  }

  const { email } = parsed.data
  const next = safeNext(parsed.data.next)

  let limit
  try {
    limit = await checkOtpRateLimit(email)
  } catch {
    // Do not disclose infrastructure details or whether an address exists.
    return {
      email,
      error: 'We could not send the email right now. Please try again shortly.',
    }
  }
  if (!limit.ok) {
    return {
      email,
      error:
        limit.scope === 'identifier'
          ? `Too many emails requested for this address. Try again in ${
              limit.retryAfterSeconds >= 3600 ? 'an hour' : 'a minute'
            }.`
          : 'Too many emails requested from this connection. Try again in an hour.',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Signing in is how an account is made (PRD §6.3).
      shouldCreateUser: true,
      emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (error) {
    // Never echo the provider's raw message: it can leak whether an address is
    // already registered, and Supabase's built-in mailer returns its hourly
    // rate limit as an error here too.
    return {
      email,
      error:
        'We could not send the email. Check the address, or call us and we will book it by hand.',
    }
  }

  return { email, sent: true }
}

/**
 * The origin to send her back to.
 *
 * Read from the request rather than only from NEXT_PUBLIC_SITE_URL, so a
 * preview deployment confirms back to itself instead of bouncing to production
 * — where the code_verifier cookie does not exist and the link would fail.
 */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  try {
    const h = await headers()
    const host = h.get('host')
    if (host) {
      const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1')
        ? 'http'
        : 'https'
      return `${proto}://${host}`
    }
  } catch {
    // No request scope.
  }
  return configured ?? 'https://alongco.com'
}

function safeNext(next: string | undefined): string {
  if (!next) return '/bookings'
  if (!next.startsWith('/') || next.startsWith('//')) return '/bookings'
  return next
}
