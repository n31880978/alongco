import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Razorpay mode detection and the money boundary.
 *
 * The failure being guarded against is the expensive one: real customers paying
 * into a test account, or a rounding step creeping into an amount.
 */

async function load() {
  vi.resetModules()
  return import('@/lib/payments/razorpay/client')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('razorpayMode', () => {
  it('reads live from a live key', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_live_abc123')
    const { razorpayMode } = await load()
    expect(razorpayMode()).toBe('live')
  })

  it('reads test from a test key', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_abc123')
    const { razorpayMode } = await load()
    expect(razorpayMode()).toBe('test')
  })

  it('defaults to test when unset, never to live', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', '')
    const { razorpayMode } = await load()
    expect(razorpayMode()).toBe('test')
  })

  /**
   * Mode is derived from the key rather than a separate env var precisely so
   * the two cannot disagree. A malformed key is refused instead of being
   * guessed at, because guessing wrong in either direction loses money.
   */
  it('refuses a key that is neither test nor live', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'some_other_key')
    const { razorpayMode } = await load()
    expect(() => razorpayMode()).toThrow(/rzp_test_ or rzp_live_/)
  })
})

describe('razorpayFetch', () => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_abc')
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'secret_value')
  })

  it('refuses to call out when credentials are missing', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', '')
    vi.stubEnv('RAZORPAY_KEY_SECRET', '')
    const { razorpayFetch } = await load()
    await expect(razorpayFetch('/orders', { method: 'GET' })).rejects.toThrow(
      /credentials are not configured/,
    )
  })

  it('sends basic auth and the idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'order_1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { razorpayFetch } = await load()
    await razorpayFetch('/orders', {
      method: 'POST',
      body: { amount: 49900 },
      idempotencyKey: 'RAC-ABC123-1',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.razorpay.com/v1/orders')
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('rzp_test_abc:secret_value').toString('base64')}`,
    )
    expect(init.headers['X-Razorpay-Idempotency-Key']).toBe('RAC-ABC123-1')
  })

  it('surfaces the provider description on an error, not the raw body', async () => {
    // A fresh Response per call: a body can only be read once.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { description: 'The amount exceeds the balance', code: 'BAD_REQUEST' },
          }),
          { status: 400 },
        ),
      ),
    )

    const { razorpayFetch, RazorpayError } = await load()

    let error: InstanceType<typeof RazorpayError> | undefined
    try {
      await razorpayFetch('/orders', { method: 'POST' })
    } catch (e) {
      error = e as InstanceType<typeof RazorpayError>
    }

    expect(error).toBeInstanceOf(RazorpayError)
    expect(error?.message).toMatch(/amount exceeds the balance/)
    expect(error?.status).toBe(400)
    expect(error?.code).toBe('BAD_REQUEST')
  })

  it('does not leak a non-JSON gateway error page into the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<html>502 Bad Gateway — upstream secrets here</html>', {
          status: 502,
        }),
      ),
    )

    const { razorpayFetch } = await load()

    let message = ''
    try {
      await razorpayFetch('/orders', { method: 'GET' })
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toMatch(/Razorpay request failed \(502\)/)
    // §9 — a gateway error page must never reach a log line.
    expect(message).not.toMatch(/upstream secrets/)
  })
})

describe('orders — the money boundary', () => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_abc')
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'secret_value')
  })

  /**
   * CLAUDE.md §3.2. Razorpay is integer paise on the wire, so 49900 must arrive
   * as 49900 — not 499, and not 499.00. A gateway that took rupees would need a
   * conversion here and this is the test that would catch it going missing.
   */
  it('sends integer paise unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'order_1', amount: 49900 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    vi.resetModules()
    const { createOrder } = await import('@/lib/payments/razorpay/orders')
    await createOrder({
      receipt: 'AC-ABC123-1',
      amountPaise: 49900,
      bookingReference: 'AC-ABC123',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.amount).toBe(49900)
    expect(body.currency).toBe('INR')
    // Without this the payment is only authorised and the money never moves.
    expect(body.payment_capture).toBe(1)
    // §9 — the note carries the reference and nothing identifying.
    expect(body.notes).toEqual({ booking_reference: 'AC-ABC123' })
  })

  it('sends an exact half-rupee refund without rounding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'rfnd_1', status: 'processed' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    vi.resetModules()
    const { createRefund } = await import('@/lib/payments/razorpay/refunds')
    // A 50% refund of ₹499 is ₹249.50 = 24950 paise (CLAUDE.md §3.11).
    await createRefund({
      providerPaymentId: 'pay_1',
      refundReference: 'RAC-ABC123-1',
      amountPaise: 24950,
      note: '24h_half',
    })

    const [url, init] = fetchMock.mock.calls[0]
    // Razorpay refunds are against the payment, not the order.
    expect(url).toContain('/payments/pay_1/refund')
    expect(JSON.parse(init.body).amount).toBe(24950)
  })

  it('rejects a non-integer amount rather than silently truncating', async () => {
    vi.resetModules()
    const { createOrder } = await import('@/lib/payments/razorpay/orders')
    await expect(
      createOrder({ receipt: 'r', amountPaise: 499.5, bookingReference: 'AC-1' }),
    ).rejects.toThrow(/positive integer/)
  })
})

describe('status mapping', () => {
  it('never treats an authorised payment as captured', async () => {
    vi.resetModules()
    const { mapPaymentStatus } = await import('@/lib/payments/razorpay/orders')
    // Money held, not taken. Confirming on this would commit a companion's hour
    // against funds that can still expire back to the customer.
    expect(mapPaymentStatus('authorized')).toBe('pending')
    expect(mapPaymentStatus('captured')).toBe('captured')
    expect(mapPaymentStatus('failed')).toBe('failed')
  })

  it('maps refund states onto the refund_status enum', async () => {
    vi.resetModules()
    const { mapRefundStatus } = await import('@/lib/payments/razorpay/refunds')
    expect(mapRefundStatus('processed')).toBe('success')
    expect(mapRefundStatus('pending')).toBe('pending')
    expect(mapRefundStatus('failed')).toBe('failed')
    expect(mapRefundStatus('anything_else')).toBe('created')
  })
})
