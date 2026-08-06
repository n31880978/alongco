import { z } from 'zod'

/**
 * Email is the sign-in identity. The phone number is still collected, but at
 * checkout and unverified — see 0011 for why that trade was made and what
 * absorbs the risk.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.')

/** 'a••••••a@gmail.com' — what the details screen shows once verified. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || local.length === 0) return email
  if (local.length <= 2) return `${local[0]}•@${domain}`
  return `${local[0]}${'•'.repeat(Math.min(local.length - 2, 6))}${local.at(-1)}@${domain}`
}

/**
 * Supabase sends a 6-digit code when the email template contains {{ .Token }}.
 * A magic link would arrive in the same message; accepting 6 digits here keeps
 * the "enter the code" flow the design draws, on one screen, without a round
 * trip through the mail client.
 */
export const otpTokenSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code exactly as it arrived.')
