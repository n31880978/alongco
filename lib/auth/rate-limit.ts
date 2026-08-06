import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

/**
 * OTP throttling. PRD §6.3 — rate limited per phone number and per IP.
 *
 * Supabase Auth has its own limits, but they are global rather than tunable per
 * project the way this needs to be, so the window is enforced here as well.
 *
 * Nothing stored is reversible to a phone number (CLAUDE.md §9): only a salted
 * hash goes into otp_requests, and the raw number never reaches a log line.
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

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; scope: 'phone' | 'ip' }

export async function checkOtpRateLimit(phone: string): Promise<RateLimitResult> {
  const supabase = await createClient()
  const phoneHash = hashIdentifier(phone)
  const ipHash = hashIdentifier(await clientIp())
  const { data, error } = await supabase.rpc('ac_consume_otp_rate_limit', {
    p_phone_hash: phoneHash,
    p_ip_hash: ipHash,
  })
  const row = data?.[0]

  if (error || !row) throw new Error('OTP rate limit check failed')
  if (row.allowed) return { ok: true }

  return {
    ok: false,
    retryAfterSeconds: row.retry_after_seconds,
    scope: row.scope === 'ip' ? 'ip' : 'phone',
  }
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
    const supabase = await createClient()
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
