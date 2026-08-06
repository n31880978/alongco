import 'server-only'

/**
 * Razorpay REST client.
 *
 * Server only. The key secret never reaches the browser — the browser gets the
 * publishable key id and an order id, and nothing else.
 *
 * Razorpay works in integer paise throughout, which is what CLAUDE.md §3.2
 * asks for. Unlike the Cashfree client this replaces, there is no rupee-decimal
 * conversion anywhere in this path, so there is no float in it at all.
 */

export const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1'

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'RazorpayError'
  }
}

/**
 * Test and live are distinguished by the key itself (`rzp_test_` / `rzp_live_`)
 * rather than by a separate env var, so the two cannot disagree. A key that
 * says test and an env that says production is exactly how real customers end
 * up paying into a sandbox.
 */
export function razorpayMode(): 'test' | 'live' {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? ''
  if (keyId.startsWith('rzp_live_')) return 'live'
  if (keyId.startsWith('rzp_test_')) return 'test'
  if (keyId === '') return 'test'
  throw new RazorpayError(
    'RAZORPAY_KEY_ID must begin with rzp_test_ or rzp_live_',
    500,
  )
}

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!keyId || !keySecret) {
    throw new RazorpayError('Razorpay credentials are not configured', 500)
  }
  return { keyId, keySecret }
}

/**
 * One place that talks to Razorpay.
 *
 * `idempotencyKey` is sent as X-Razorpay-Idempotency-Key. Razorpay honours it
 * on refund creation, so a retried refund after a timeout returns the original
 * refund rather than issuing a second one. Two further guards sit behind it
 * regardless: ac_refund_quote caps at what is still refundable, and Razorpay
 * itself refuses to refund more than was captured.
 */
export async function razorpayFetch<T>(
  path: string,
  init: {
    method: 'GET' | 'POST'
    body?: unknown
    idempotencyKey?: string
  },
): Promise<T> {
  const { keyId, keySecret } = credentials()
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')

  const response = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.idempotencyKey
        ? { 'X-Razorpay-Idempotency-Key': init.idempotencyKey }
        : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })

  const text = await response.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON body; keep the raw text out of the thrown message so a gateway
    // error page cannot end up in a log line (CLAUDE.md §9).
  }

  if (!response.ok) {
    const err = payload?.error
    throw new RazorpayError(
      err?.description ?? `Razorpay request failed (${response.status})`,
      response.status,
      err?.code,
      err?.reason,
    )
  }

  return payload as T
}
