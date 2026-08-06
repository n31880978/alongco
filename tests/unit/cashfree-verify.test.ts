import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  verifyWebhookSignature,
  webhookEventId,
  type CashfreeWebhookPayload,
} from '@/lib/cashfree/verify'

/**
 * T12 — an invalid signature must be rejected. PRD §6.6.
 *
 * Cashfree signs `timestamp + rawBody` with the merchant secret and base64s it.
 */

const SECRET = 'test-webhook-secret'
const NOW = new Date('2027-03-10T12:00:00Z')

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(timestamp + rawBody).digest('base64')
}

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} })
  const timestamp = String(Math.floor(NOW.getTime() / 1000))

  beforeEach(() => {
    process.env.CASHFREE_WEBHOOK_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.CASHFREE_WEBHOOK_SECRET
  })

  it('accepts a correctly signed payload', () => {
    const result = verifyWebhookSignature(body, sign(body, timestamp), timestamp, NOW)
    expect(result.ok).toBe(true)
  })

  it('rejects a signature made with the wrong secret', () => {
    const bad = sign(body, timestamp, 'not-the-secret')
    expect(verifyWebhookSignature(body, bad, timestamp, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejects a tampered body even when the signature is well-formed', () => {
    const signature = sign(body, timestamp)
    const tampered = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: { order: { order_amount: 1 } },
    })
    expect(verifyWebhookSignature(tampered, signature, timestamp, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejects a signature computed without the timestamp prefix', () => {
    const naive = createHmac('sha256', SECRET).update(body).digest('base64')
    expect(verifyWebhookSignature(body, naive, timestamp, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejects a replayed webhook from outside the skew window', () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 3600)
    expect(verifyWebhookSignature(body, sign(body, old), old, NOW)).toEqual({
      ok: false,
      reason: 'stale',
    })
  })

  it('accepts a timestamp a little in the past', () => {
    const recent = String(Math.floor(NOW.getTime() / 1000) - 60)
    expect(verifyWebhookSignature(body, sign(body, recent), recent, NOW).ok).toBe(true)
  })

  it('rejects missing headers', () => {
    expect(verifyWebhookSignature(body, null, timestamp, NOW)).toEqual({
      ok: false,
      reason: 'missing_headers',
    })
    expect(verifyWebhookSignature(body, sign(body, timestamp), null, NOW)).toEqual({
      ok: false,
      reason: 'missing_headers',
    })
  })

  it('rejects a non-numeric timestamp rather than trusting it', () => {
    expect(verifyWebhookSignature(body, 'x', 'not-a-number', NOW)).toEqual({
      ok: false,
      reason: 'stale',
    })
  })

  it('refuses to verify at all when no secret is configured', () => {
    delete process.env.CASHFREE_WEBHOOK_SECRET
    delete process.env.CASHFREE_SECRET_KEY
    expect(verifyWebhookSignature(body, sign(body, timestamp), timestamp, NOW)).toEqual({
      ok: false,
      reason: 'missing_secret',
    })
  })

  it('falls back to the API secret when no dedicated webhook secret is set', () => {
    delete process.env.CASHFREE_WEBHOOK_SECRET
    process.env.CASHFREE_SECRET_KEY = SECRET
    expect(verifyWebhookSignature(body, sign(body, timestamp), timestamp, NOW).ok).toBe(
      true,
    )
    delete process.env.CASHFREE_SECRET_KEY
  })
})

describe('webhookEventId', () => {
  it('is stable across redeliveries of the same payment event', () => {
    const payload: CashfreeWebhookPayload = {
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: { payment: { cf_payment_id: 987654 }, order: { order_id: 'AC-ABC123-X' } },
    }
    expect(webhookEventId(payload)).toBe('PAYMENT_SUCCESS_WEBHOOK:987654')
    expect(webhookEventId({ ...payload })).toBe(webhookEventId(payload))
  })

  it('distinguishes a failure event from a success event for the same payment', () => {
    const base = { payment: { cf_payment_id: 1 } }
    expect(webhookEventId({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: base })).not.toBe(
      webhookEventId({ type: 'PAYMENT_FAILED_WEBHOOK', data: base }),
    )
  })

  it('keys a refund event on the refund', () => {
    expect(
      webhookEventId({
        type: 'REFUND_STATUS_WEBHOOK',
        data: { refund: { cf_refund_id: 55, refund_id: 'AC-ABC123-R1' } },
      }),
    ).toBe('REFUND_STATUS_WEBHOOK:55')
  })

  it('returns null when there is nothing to key on, so it is never processed', () => {
    expect(webhookEventId({ type: 'SOMETHING', data: {} })).toBeNull()
  })
})
