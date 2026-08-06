'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkOtpRateLimit } from '@/lib/auth/rate-limit'
import { emailSchema, otpTokenSchema } from '@/lib/auth/email'
import { CONSENT_VERSION } from '@/lib/booking/terms'

/**
 * Email OTP. Supabase generates, sends and verifies the code, so it never
 * passes through this application.
 *
 * Email rather than SMS because delivering SMS in India needs DLT registration
 * and costs per message. The consequence is that the WhatsApp number is no
 * longer proven by signing in — it is collected at checkout instead (0011).
 *
 * Admin sign-in is a separate credential class entirely (email + password), so
 * nothing here can produce a session that reaches the operations surface.
 */

export type OtpState = {
  error?: string
  email?: string
  sent?: boolean
}

const requestSchema = z.object({ email: emailSchema })

export async function requestOtp(
  _prev: OtpState,
  formData: FormData,
): Promise<OtpState> {
  const parsed = requestSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid email address.' }
  }

  const email = parsed.data.email

  let limit
  try {
    limit = await checkOtpRateLimit(email)
  } catch {
    // Do not disclose infrastructure details or whether an address exists.
    return {
      email,
      error: 'We could not send the code right now. Please try again shortly.',
    }
  }
  if (!limit.ok) {
    return {
      email,
      error:
        limit.scope === 'identifier'
          ? `Too many codes requested for this address. Try again in ${
              limit.retryAfterSeconds >= 3600 ? 'an hour' : 'a minute'
            }.`
          : 'Too many codes requested from this connection. Try again in an hour.',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // First-time addresses are allowed: signing in is how an account is made
      // (PRD §6.3 — one customer record, created on first verification).
      shouldCreateUser: true,
    },
  })

  if (error) {
    // Never echo the provider's raw message: it can leak whether an address is
    // already registered. Say what she should do instead.
    return {
      email,
      error:
        'We could not send the code. Check the address, or call us and we will book it by hand.',
    }
  }

  return { email, sent: true }
}

const verifySchema = z.object({
  email: emailSchema,
  token: otpTokenSchema,
  next: z.string().optional(),
})

export async function verifyOtp(_prev: OtpState, formData: FormData): Promise<OtpState> {
  const parsed = verifySchema.safeParse({
    email: formData.get('email'),
    token: formData.get('token'),
    next: formData.get('next'),
  })
  if (!parsed.success) {
    return {
      email: String(formData.get('email') ?? ''),
      sent: true,
      error: parsed.error.issues[0]?.message ?? 'That code did not look right.',
    }
  }

  const { email, token, next } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
  if (error) {
    return {
      email,
      sent: true,
      error: 'That code was wrong or has expired. Ask for a new one.',
    }
  }

  // Creates the customer record on first verification, adopting an existing row
  // if this address has booked before (PRD §6.3).
  const { error: customerError } = await supabase.rpc('ac_ensure_customer', {
    p_consent_version: CONSENT_VERSION,
  })
  if (customerError) {
    return {
      email,
      sent: true,
      error: 'You are signed in, but we could not open your account. Please call us.',
    }
  }

  redirect(safeNext(next))
}

/**
 * Only same-origin paths. An open redirect on the sign-in step is how a
 * phishing page gets a freshly authenticated customer handed to it.
 */
function safeNext(next: string | undefined): string {
  if (!next) return '/bookings'
  if (!next.startsWith('/') || next.startsWith('//')) return '/bookings'
  return next
}
