import { z } from 'zod'

/**
 * Indian mobile numbers only, in E.164 without the leading '+', which is the
 * shape Supabase Auth expects and what ac_ensure_customer normalises to.
 */

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^\d]/g, ''))
  .refine((v) => /^(91)?[6-9]\d{9}$/.test(v), {
    message: 'Enter a 10-digit Indian mobile number.',
  })
  .transform((v) => (v.length === 10 ? `91${v}` : v))

export type NormalisedPhone = string

/** '+91 98765 43210' — display only. Never written to a log. */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, '')
  const local = digits.startsWith('91') ? digits.slice(2) : digits
  if (local.length !== 10) return `+${digits}`
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
}

/** '+91 98xxx xxxxx' — what the details screen shows once verified. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, '')
  const local = digits.startsWith('91') ? digits.slice(2) : digits
  if (local.length !== 10) return '+91 xxxxx xxxxx'
  return `+91 ${local.slice(0, 2)}xxx xxxxx`
}

/**
 * SMS by default, delivered through MSG91 via the Supabase Send-SMS auth hook
 * (supabase/functions/send-sms-otp). Supabase has no native MSG91 provider, so
 * the hook is what makes the choice possible at all.
 *
 * Set NEXT_PUBLIC_OTP_CHANNEL=whatsapp to switch channels — the app code is the
 * same either way, only the Supabase Auth provider configuration changes.
 */
export const OTP_CHANNEL: 'whatsapp' | 'sms' =
  process.env.NEXT_PUBLIC_OTP_CHANNEL === 'whatsapp' ? 'whatsapp' : 'sms'
