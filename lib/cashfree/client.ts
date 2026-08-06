import 'server-only'

/**
 * Cashfree Payment Gateway, API version 2025-01-01 (CLAUDE.md §1).
 *
 * Server only. The app id and secret never reach the browser — the browser gets
 * a `payment_session_id` and nothing else.
 */

export const CASHFREE_API_VERSION = '2025-01-01'

export type CashfreeEnv = 'sandbox' | 'production'

/**
 * Which Cashfree to talk to.
 *
 * Normalised rather than compared raw: a trailing inline comment or stray
 * whitespace in the env file ("production  # live") would otherwise fail the
 * equality check and silently keep real customers on the sandbox, where their
 * payments succeed and no money ever moves. An unrecognised value is refused
 * outright instead of quietly defaulting — a typo here is a business outage,
 * not a preference.
 */
export function cashfreeEnv(): CashfreeEnv {
  const raw = (process.env.CASHFREE_ENV ?? 'sandbox')
    .split('#')[0]
    .trim()
    .toLowerCase()

  if (raw === 'production') return 'production'
  if (raw === 'sandbox' || raw === '') return 'sandbox'

  throw new CashfreeError(
    `CASHFREE_ENV must be "sandbox" or "production", not "${raw}"`,
    500,
  )
}

export function cashfreeBaseUrl(): string {
  return cashfreeEnv() === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg'
}

export class CashfreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly type?: string,
  ) {
    super(message)
    this.name = 'CashfreeError'
  }
}

function credentials(): { appId: string; secret: string } {
  const appId = process.env.CASHFREE_APP_ID
  const secret = process.env.CASHFREE_SECRET_KEY
  if (!appId || !secret) {
    throw new CashfreeError('Cashfree credentials are not configured', 500)
  }
  return { appId, secret }
}

/**
 * One place that talks to Cashfree.
 *
 * `idempotencyKey` is passed as x-idempotency-key so a retried order or refund
 * cannot double-charge or double-refund if our request times out after Cashfree
 * has already accepted it.
 */
export async function cashfreeFetch<T>(
  path: string,
  init: {
    method: 'GET' | 'POST'
    body?: unknown
    idempotencyKey?: string
  },
): Promise<T> {
  const { appId, secret } = credentials()

  const response = await fetch(`${cashfreeBaseUrl()}${path}`, {
    method: init.method,
    headers: {
      'x-api-version': CASHFREE_API_VERSION,
      'x-client-id': appId,
      'x-client-secret': secret,
      'Content-Type': 'application/json',
      ...(init.idempotencyKey ? { 'x-idempotency-key': init.idempotencyKey } : {}),
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
    // error page cannot end up in a log line.
  }

  if (!response.ok) {
    throw new CashfreeError(
      payload?.message ?? `Cashfree request failed (${response.status})`,
      response.status,
      payload?.code,
      payload?.type,
    )
  }

  return payload as T
}
