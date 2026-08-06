import 'server-only'
import { cashfreeFetch } from './client'
import { paiseToRupees } from '@/lib/booking/pricing'

/**
 * Order creation. CLAUDE.md §3.1/§3.2.
 *
 * The amount passed in is integer paise, taken from the booking row the RPC
 * snapshotted. Cashfree's API takes rupees as a decimal, so the conversion
 * happens here and nowhere else — this is the only float in the payment path,
 * and it is at the wire boundary.
 */

export type CreateOrderInput = {
  /** Our order id. Unique per checkout attempt, so a retry is a new order. */
  orderId: string
  amountPaise: number
  bookingReference: string
  customer: {
    id: string
    phone: string
    name: string | null
  }
  returnUrl: string
  notifyUrl: string
  /** Cashfree closes the order at this instant — aligned to our hold expiry. */
  expiresAt: Date
}

export type CashfreeOrder = {
  cf_order_id: string
  order_id: string
  order_status: string
  payment_session_id: string
  order_amount: number
  order_currency: string
}

export async function createOrder(input: CreateOrderInput): Promise<CashfreeOrder> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('amountPaise must be a positive integer')
  }

  // Cashfree rejects an expiry under a few minutes out; never send one in the
  // past just because the hold is nearly up.
  const minimum = new Date(Date.now() + 5 * 60_000)
  const expiry = input.expiresAt > minimum ? input.expiresAt : minimum

  return cashfreeFetch<CashfreeOrder>('/orders', {
    method: 'POST',
    idempotencyKey: input.orderId,
    body: {
      order_id: input.orderId,
      order_amount: paiseToRupees(input.amountPaise),
      order_currency: 'INR',
      order_expiry_time: expiry.toISOString(),
      customer_details: {
        customer_id: input.customer.id,
        customer_phone: input.customer.phone,
        // Cashfree requires a name field; the pseudonymous fallback keeps us
        // from failing the order when she has not entered one yet.
        customer_name: input.customer.name ?? 'AlongCo customer',
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: input.notifyUrl,
      },
      // Never put a real name or a phone number in a note — it appears in
      // dashboards and settlement reports (CLAUDE.md §9).
      order_note: `AlongCo ${input.bookingReference}`,
      order_tags: { booking_reference: input.bookingReference },
    },
  })
}

export type CashfreeOrderStatus = {
  order_id: string
  order_status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED' | string
  order_amount: number
}

/** Read-back used by the return page and by reconciliation. Never sets state. */
export async function getOrder(orderId: string): Promise<CashfreeOrderStatus> {
  return cashfreeFetch<CashfreeOrderStatus>(`/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
  })
}

export type CashfreePayment = {
  cf_payment_id: string
  order_id: string
  payment_status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'USER_DROPPED' | string
  payment_amount: number
  payment_method?: unknown
  payment_message?: string
  payment_time?: string
}

export async function getOrderPayments(orderId: string): Promise<CashfreePayment[]> {
  const payments = await cashfreeFetch<CashfreePayment[]>(
    `/orders/${encodeURIComponent(orderId)}/payments`,
    { method: 'GET' },
  )
  return Array.isArray(payments) ? payments : []
}

/**
 * Cashfree reports the method as an object keyed by instrument
 * ({ upi: {...} }). We store only the key — never the instrument itself (§9).
 */
export function paymentMethodName(method: unknown): string | null {
  if (!method) return null
  if (typeof method === 'string') return method
  if (typeof method === 'object') {
    const keys = Object.keys(method as Record<string, unknown>)
    return keys[0] ?? null
  }
  return null
}
