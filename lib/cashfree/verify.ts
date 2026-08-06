import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhook signature verification. CLAUDE.md §3.3/§3.4, PRD §6.6.
 *
 * Cashfree signs `timestamp + rawBody` with the merchant secret and sends the
 * result base64-encoded in `x-webhook-signature`, with the timestamp in
 * `x-webhook-timestamp`.
 *
 * The raw body matters: re-serialising the parsed JSON changes key order and
 * whitespace, and the signature stops matching. The route handler must pass the
 * exact bytes it received.
 */

export const SIGNATURE_HEADER = 'x-webhook-signature'
export const TIMESTAMP_HEADER = 'x-webhook-timestamp'

/** Reject anything older than this, so a captured webhook cannot be replayed later. */
const MAX_SKEW_SECONDS = 5 * 60

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'stale' | 'mismatch' }

function secret(): string | undefined {
  return process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  now: Date = new Date(),
): VerificationResult {
  const key = secret()
  if (!key) return { ok: false, reason: 'missing_secret' }
  if (!signature || !timestamp) return { ok: false, reason: 'missing_headers' }

  // Cashfree sends epoch seconds. Reject a timestamp we cannot read at all.
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'stale' }

  const skew = Math.abs(Math.floor(now.getTime() / 1000) - sentAt)
  if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale' }

  const expected = createHmac('sha256', key)
    .update(timestamp + rawBody)
    .digest('base64')

  return safeEqual(expected, signature) ? { ok: true } : { ok: false, reason: 'mismatch' }
}

/** Constant-time compare that does not leak length through an early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * The subset of the webhook payload we act on.
 * Cashfree nests everything under `data`, with the event name at the top level.
 */
export type CashfreeWebhookPayload = {
  type?: string
  event_time?: string
  data?: {
    order?: {
      order_id?: string
      order_amount?: number
      order_currency?: string
    }
    payment?: {
      cf_payment_id?: string | number
      payment_status?: string
      payment_amount?: number
      payment_currency?: string
      payment_message?: string
      payment_time?: string
      payment_method?: unknown
    }
    refund?: {
      cf_refund_id?: string | number
      refund_id?: string
      refund_status?: string
      refund_amount?: number
    }
    customer_details?: unknown
  }
}

/**
 * A stable id for `webhook_events`, so a redelivery is recognised as the same
 * event (§3.4). Cashfree does not send an explicit event id, so it is composed
 * from the event type plus the payment or refund it concerns.
 */
export function webhookEventId(payload: CashfreeWebhookPayload): string | null {
  const type = payload.type ?? 'unknown'
  const paymentId = payload.data?.payment?.cf_payment_id
  const refundId = payload.data?.refund?.cf_refund_id ?? payload.data?.refund?.refund_id
  const orderId = payload.data?.order?.order_id

  if (paymentId) return `${type}:${paymentId}`
  if (refundId) return `${type}:${refundId}`
  if (orderId) return `${type}:${orderId}`
  return null
}
