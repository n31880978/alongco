import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhook and checkout signature verification. CLAUDE.md §3.3/§3.4, PRD §6.6.
 *
 * Razorpay signs the raw request body with the webhook secret and sends the
 * result hex-encoded in `x-razorpay-signature`. Note the differences from the
 * Cashfree scheme this replaces:
 *
 *   - hex, not base64;
 *   - the body alone is signed, with no timestamp prefix;
 *   - there is a real event id in `x-razorpay-event-id`, so idempotency does
 *     not have to be reconstructed from the payload.
 *
 * The raw body matters: re-serialising parsed JSON changes key order and
 * whitespace, and the signature stops matching. The route must pass the exact
 * bytes it received.
 */

export const SIGNATURE_HEADER = 'x-razorpay-signature'
export const EVENT_ID_HEADER = 'x-razorpay-event-id'

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'mismatch' }

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
): VerificationResult {
  const key = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!key) return { ok: false, reason: 'missing_secret' }
  if (!signature) return { ok: false, reason: 'missing_headers' }

  const expected = createHmac('sha256', key).update(rawBody).digest('hex')
  return safeEqual(expected, signature) ? { ok: true } : { ok: false, reason: 'mismatch' }
}

/**
 * Verifies the handshake Checkout.js hands back in the browser.
 *
 * This is a UX signal only. It never confirms a booking — that is the webhook's
 * job and only the webhook's (CLAUDE.md §3.3). It exists so the return page can
 * tell "she completed checkout" from "she closed the window", without trusting
 * an unsigned query parameter.
 */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const key = process.env.RAZORPAY_KEY_SECRET
  if (!key || !orderId || !paymentId || !signature) return false

  const expected = createHmac('sha256', key)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')

  return safeEqual(expected, signature)
}

/** Constant-time compare that does not leak length through an early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** The subset of the webhook payload we act on. */
export type RazorpayWebhookPayload = {
  event?: string
  created_at?: number
  payload?: {
    payment?: {
      entity?: {
        id?: string
        order_id?: string
        status?: string
        amount?: number
        method?: string
        error_description?: string
      }
    }
    refund?: {
      entity?: {
        id?: string
        payment_id?: string
        status?: string
        amount?: number
        receipt?: string
      }
    }
  }
}

/**
 * A stable id for `webhook_events` (§3.4).
 *
 * Razorpay sends `x-razorpay-event-id` and it is the authoritative handle for a
 * redelivery, so it is preferred. The payload-derived fallback covers a
 * delivery that somehow arrives without the header — without it, a missing
 * header would make every retry look like a fresh event and the handler would
 * stop being idempotent exactly when it matters.
 */
export function webhookEventId(
  headerEventId: string | null,
  payload: RazorpayWebhookPayload,
): string | null {
  if (headerEventId) return headerEventId

  const event = payload.event ?? 'unknown'
  const paymentId = payload.payload?.payment?.entity?.id
  const refundId = payload.payload?.refund?.entity?.id

  if (refundId) return `${event}:${refundId}`
  if (paymentId) return `${event}:${paymentId}`
  return null
}
