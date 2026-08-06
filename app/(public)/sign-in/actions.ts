'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkOtpRateLimit } from '@/lib/auth/rate-limit'
import { OTP_CHANNEL, phoneSchema } from '@/lib/auth/phone'
import { CONSENT_VERSION } from '@/lib/booking/terms'

/**
 * Phone OTP over SMS, delivered by MSG91 through the Supabase Send-SMS auth
 * hook (supabase/functions/send-sms-otp). Supabase generates and verifies the
 * code; the hook only carries it to MSG91, so the OTP never passes through this
 * application.
 *
 * Delivery in India requires a DLT-registered sender ID and template — see the
 * hook for what has to be registered before this works in production. Set
 * NEXT_PUBLIC_OTP_CHANNEL=whatsapp to switch channels with no code change.
 *
 * Admin confirmations remain manual from the WhatsApp Business app; this is the
 * auth provider only, not the messaging integration CLAUDE.md §1 rules out.
 */

export type OtpState = {
  error?: string
  phone?: string
  sent?: boolean
}

const requestSchema = z.object({ phone: phoneSchema })

export async function requestOtp(
  _prev: OtpState,
  formData: FormData,
): Promise<OtpState> {
  const parsed = requestSchema.safeParse({ phone: formData.get('phone') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid mobile number.' }
  }

  const phone = parsed.data.phone

  let limit
  try {
    limit = await checkOtpRateLimit(phone)
  } catch {
    // Do not disclose infrastructure details or whether a phone number exists.
    return {
      phone,
      error: 'We could not send the code right now. Please try again shortly.',
    }
  }
  if (!limit.ok) {
    return {
      phone,
      error:
        limit.scope === 'phone'
          ? `Too many codes requested for this number. Try again in ${
              limit.retryAfterSeconds >= 3600 ? 'an hour' : 'a minute'
            }.`
          : 'Too many codes requested from this connection. Try again in an hour.',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { channel: OTP_CHANNEL },
  })

  if (error) {
    // Never echo the provider's raw message: it can leak whether a number is
    // registered. Say what she should do instead.
    return {
      phone,
      error:
        'We could not send the code. Check the number, or call us and we will book it by hand.',
    }
  }

  return { phone, sent: true }
}

const verifySchema = z.object({
  phone: phoneSchema,
  token: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code exactly as it arrived.'),
  next: z.string().optional(),
})

export async function verifyOtp(_prev: OtpState, formData: FormData): Promise<OtpState> {
  const parsed = verifySchema.safeParse({
    phone: formData.get('phone'),
    token: formData.get('token'),
    next: formData.get('next'),
  })
  if (!parsed.success) {
    return {
      phone: String(formData.get('phone') ?? ''),
      sent: true,
      error: parsed.error.issues[0]?.message ?? 'That code did not look right.',
    }
  }

  const { phone, token, next } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
  if (error) {
    return {
      phone,
      sent: true,
      error: 'That code was wrong or has expired. Ask for a new one.',
    }
  }

  // Creates the customer record on first verification, adopting an existing row
  // if this number has booked before (PRD §6.3).
  const { error: customerError } = await supabase.rpc('ac_ensure_customer', {
    p_consent_version: CONSENT_VERSION,
  })
  if (customerError) {
    return {
      phone,
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
