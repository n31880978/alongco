import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Salted hashing and client IP, still used by the ADMIN login throttle
 * (app/(admin)/admin/sign-in/actions.ts). Nothing stored is reversible to the
 * address (CLAUDE.md §9).
 */

function salt(): string {
  const value = process.env.OTP_HASH_SALT
  if (!value) throw new Error('OTP_HASH_SALT is not set')
  return value
}

export function hashIdentifier(value: string): string {
  return createHash('sha256').update(`${salt()}:${value}`).digest('hex')
}

export async function clientIp(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return h.get('x-real-ip') ?? 'unknown'
}

/** Database-backed limits survive serverless instances and deployment restarts. */
export async function allowPublicBookingAttempt(email: string): Promise<boolean> {
  const service = createServiceClient()
  const [ipAllowed, emailAllowed] = await Promise.all([
    (service.rpc as any)('ac_consume_public_action_limit', {
      p_scope: 'booking_ip',
      p_subject_hash: hashIdentifier(await clientIp()),
      p_max_attempts: 20,          // raised: 20 attempts per IP per window
      p_window_seconds: 15 * 60,
    }),
    (service.rpc as any)('ac_consume_public_action_limit', {
      p_scope: 'booking_email',
      p_subject_hash: hashIdentifier(email.trim().toLowerCase()),
      p_max_attempts: 10,          // raised: 10 attempts per email per window
      p_window_seconds: 15 * 60,
    }),
  ])
  // If the RPC itself errors (e.g. function not yet deployed), fail open so
  // legitimate customers are never silently blocked by an infrastructure gap.
  if (ipAllowed.error || emailAllowed.error) return true
  return Boolean(ipAllowed.data) && Boolean(emailAllowed.data)
}
