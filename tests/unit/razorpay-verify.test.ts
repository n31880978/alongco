import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('server-only', () => ({}))

/**
 * Razorpay signature verification. CLAUDE.md §3.3/§3.4, PRD §6.6.
 *
 * The acceptance criterion: a webhook with an invalid signature is rejected and
 * logged, and no booking state changes. Everything below is about making the
 * rejection impossible to get wrong.
 */

const SECRET = 'whsec_test_secret'
const KEY_SECRET = 'rzp_key_secret_value'

async function load() {
  vi.resetModules()
  return import('@/lib/payments/razorpay/verify')
}

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

beforeEach(() => {
  vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('RAZORPAY_KEY_SECRET', KEY_SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: {} })

  it('accepts a correctly signed body', async () => {
    const { verifyWebhookSignature } = await load()
    expect(verifyWebhookSignature(body, sign(body))).toEqual({ ok: true })
  })

  it('rejects a body signed with the wrong secret', async () => {
    const { verifyWebhookSignature } = await load()
    const result = verifyWebhookSignature(body, sign(body, 'not-the-secret'))
    expect(result).toEqual({ ok: false, reason: 'mismatch' })
  })

  /**
   * The reason the route must pass raw bytes rather than re-serialising: the
   * same object with keys in a different order is a different string, and the
   * HMAC will not match.
   */
  it('rejects a body whose bytes changed, even if the JSON is equivalent', async () => {
    const { verifyWebhookSignature } = await load()
    const signature = sign(body)
    const reserialised = JSON.stringify(JSON.parse(body), ['payload', 'event'])
    expect(verifyWebhookSignature(reserialised, signature)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejects a missing signature header rather than passing it through', async () => {
    const { verifyWebhookSignature } = await load()
    expect(verifyWebhookSignature(body, null)).toEqual({
      ok: false,
      reason: 'missing_headers',
    })
  })

  it('refuses everything when the secret is not configured', async () => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', '')
    const { verifyWebhookSignature } = await load()
    // Fails closed. An unconfigured deployment must not accept unsigned
    // webhooks that could confirm bookings for free.
    expect(verifyWebhookSignature(body, sign(body))).toEqual({
      ok: false,
      reason: 'missing_secret',
    })
  })

  it('does not throw on a signature of a different length', async () => {
    const { verifyWebhookSignature } = await load()
    expect(verifyWebhookSignature(body, 'short')).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })
})

describe('verifyCheckoutSignature', () => {
  const orderId = 'order_ABC123'
  const paymentId = 'pay_XYZ789'

  function checkoutSig(o: string, p: string, secret = KEY_SECRET) {
    return createHmac('sha256', secret).update(`${o}|${p}`).digest('hex')
  }

  it('accepts the handshake Checkout.js returns', async () => {
    const { verifyCheckoutSignature } = await load()
    expect(
      verifyCheckoutSignature(orderId, paymentId, checkoutSig(orderId, paymentId)),
    ).toBe(true)
  })

  it('rejects a signature for a different order', async () => {
    const { verifyCheckoutSignature } = await load()
    expect(
      verifyCheckoutSignature(orderId, paymentId, checkoutSig('order_OTHER', paymentId)),
    ).toBe(false)
  })

  it('rejects empty inputs rather than treating them as a match', async () => {
    const { verifyCheckoutSignature } = await load()
    expect(verifyCheckoutSignature('', '', '')).toBe(false)
  })
})

describe('webhookEventId', () => {
  it('prefers the provider event id header', async () => {
    const { webhookEventId } = await load()
    expect(
      webhookEventId('evt_native_123', {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_1' } } },
      }),
    ).toBe('evt_native_123')
  })

  /**
   * Without a fallback, a delivery missing the header would look like a fresh
   * event on every retry and the handler would stop being idempotent — exactly
   * when it matters, because retries only happen after something went wrong.
   */
  it('falls back to the payment id when the header is absent', async () => {
    const { webhookEventId } = await load()
    expect(
      webhookEventId(null, {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_1' } } },
      }),
    ).toBe('payment.captured:pay_1')
  })

  it('is stable across two deliveries of the same event', async () => {
    const { webhookEventId } = await load()
    const payload = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_1' } } },
    }
    expect(webhookEventId(null, payload)).toBe(webhookEventId(null, payload))
  })

  it('distinguishes a refund event from a payment event', async () => {
    const { webhookEventId } = await load()
    const refund = webhookEventId(null, {
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_1' } } },
    })
    const payment = webhookEventId(null, {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_1' } } },
    })
    expect(refund).not.toBe(payment)
  })

  it('returns null when nothing identifies the event', async () => {
    const { webhookEventId } = await load()
    expect(webhookEventId(null, { event: 'payment.captured' })).toBeNull()
  })
})
