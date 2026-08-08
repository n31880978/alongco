import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { createCustomerClient } from '@/lib/supabase/customer'

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

/**
 * Post-authentication throttling for booking holds and reviews. TASKS T21.
 *
 * Keyed on the customer rather than on an IP: both actions require a session,
 * and a per-customer limit is both simpler and harder to evade than one keyed on
 * a shared mobile network address.
 *
 * A failure here is deliberately *not* fatal. If the limiter itself is broken,
 * refusing every booking would turn a monitoring problem into an outage; the
 * database constraints still hold, so the request is allowed through.
 */
export type ActionLimit = { ok: true } | { ok: false; reason: string }

export async function checkActionRateLimit(
  action: 'booking_hold' | 'review',
  customerId: string,
): Promise<ActionLimit> {
  try {
    const supabase = createCustomerClient()
    const { data, error } = await supabase.rpc('ac_check_action_rate_limit', {
      p_action: action,
      p_customer_id: customerId,
    })
    const row = data?.[0]
    if (error || !row) return { ok: true }
    if (row.allowed) return { ok: true }
    return {
      ok: false,
      reason: row.reason ?? 'Too many attempts just now. Try again shortly.',
    }
  } catch {
    return { ok: true }
  }
}
