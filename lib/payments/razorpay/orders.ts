import 'server-only'
import { razorpayFetch } from './client'
import type { ProviderPaymentStatus } from '../provider'

/**
 * Order creation. CLAUDE.md §3.1/§3.2.
 *
 * The amount is integer paise, taken from the booking row the RPC snapshotted,
 * and Razorpay's API is integer paise too — so it goes over the wire unchanged.
 * There is no float anywhere in this file.
 */

export type CreateOrderInput = {
  /** Our receipt, unique per checkout attempt so a retry is a distinct order. */
  receipt: string
  amountPaise: number
  bookingReference: string
}

export type RazorpayOrder = {
  id: string
  amount: number
  currency: string
  receipt: string
  status: 'created' | 'attempted' | 'paid' | string
}

export async function createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('amountPaise must be a positive integer')
  }

  return razorpayFetch<RazorpayOrder>('/orders', {
    method: 'POST',
    body: {
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt,
      // Razorpay will not capture automatically unless told to. Without this the
      // payment sits authorised and the money is never actually taken.
      payment_capture: 1,
      // Notes appear in the Razorpay dashboard and settlement reports, so they
      // carry the booking reference and nothing else — never a name or a
      // number (CLAUDE.md §9).
      notes: { booking_reference: input.bookingReference },
    },
  })
}

/** Read-back for the return page and reconciliation. Never sets state. */
export async function getOrder(orderId: string): Promise<RazorpayOrder> {
  return razorpayFetch<RazorpayOrder>(`/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
  })
}

export type RazorpayPayment = {
  id: string
  order_id: string
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed' | string
  amount: number
  method?: string
  error_description?: string
  created_at?: number
}

export async function getOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
  const result = await razorpayFetch<{ items?: RazorpayPayment[] }>(
    `/orders/${encodeURIComponent(orderId)}/payments`,
    { method: 'GET' },
  )
  return Array.isArray(result?.items) ? result.items : []
}

/**
 * Razorpay payment state -> the state this application acts on.
 *
 * `authorized` is deliberately NOT captured: the money is held but not taken.
 * Treating it as paid would confirm a booking against funds that can still
 * expire back to the customer.
 */
export function mapPaymentStatus(status: string): ProviderPaymentStatus {
  switch (status) {
    case 'captured':
      return 'captured'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

/** Razorpay reports the method as a plain string ('upi', 'card'). */
export function paymentMethodName(method: unknown): string | null {
  return typeof method === 'string' && method ? method : null
}
