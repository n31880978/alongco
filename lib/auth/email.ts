import { z } from 'zod'

/**
 * Email is the sign-in identity and the confirmation channel.
 *
 * Sign-in is a confirmation link, not a code: Supabase gates email-template
 * editing behind custom SMTP, and the stock "Confirm signup" template sends
 * {{ .ConfirmationURL }} with no {{ .Token }} in it. Until SMTP is configured
 * there is no code to type, so the link is the only thing that actually works.
 * docs/supabase/email-templates/ holds the code-carrying templates for when it
 * is.
 */

/**
 * Throwaway inbox providers.
 *
 * This is a booking product, not a signup funnel: her email is how the ticket
 * and any cancellation reach her, and a paid booking against a mailbox that
 * evaporates in ten minutes is a customer we cannot contact. Blocking these
 * costs nothing — no real customer books an outing from a disposable address.
 *
 * Deliberately a small, high-confidence list rather than an exhaustive one.
 * A false positive here refuses a real woman a booking, which is far worse
 * than letting an unusual throwaway domain through.
 */
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com',
  '10minutemail.com',
  '20minutemail.com',
  'discard.email',
  'dispostable.com',
  'fakeinbox.com',
  'getairmail.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'guerrillamail.net',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'sharklasers.com',
  'spam4.me',
  'temp-mail.org',
  'tempinbox.com',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
  'yopmail.net',
])

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return false
  return DISPOSABLE_DOMAINS.has(domain)
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.')
  // Rejected by domain, not by shape, so the message can say what to do about
  // it rather than "invalid email".
  .refine((v) => !isDisposableEmail(v), {
    message:
      'That looks like a temporary inbox. Use an address you can still read tomorrow — your ticket and any changes go there.',
  })

/** 'a••••••a@gmail.com' — what the details screen shows once verified. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || local.length === 0) return email
  if (local.length <= 2) return `${local[0]}•@${domain}`
  return `${local[0]}${'•'.repeat(Math.min(local.length - 2, 6))}${local.at(-1)}@${domain}`
}
