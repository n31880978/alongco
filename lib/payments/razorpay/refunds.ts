import 'server-only'
import { razorpayFetch } from './client'
import type { ProviderRefundStatus } from '../provider'

/**
 * Refunds. PRD §6.9.
 *
 * Note the shape difference from Cashfree: Razorpay refunds are issued against
 * the PAYMENT id, not the order id. The caller therefore has to have captured
 * a provider_payment_id — an order alone is not enough to refund.
 *
 * Amounts are integer paise on both sides, so the exact ₹249.50 a 50% tier
 * produces (24950) goes over the wire as 24950 with no rounding step to get
 * wrong (CLAUDE.md §3.11).
 */

export type CreateRefundInput = {
  providerPaymentId: string
  /** Our own idempotent handle, stored on the refund row before the call. */
  refundReference: string
  amountPaise: number
  /** Settlement-report visible. Tier code only — never a name or number (§9). */
  note?: string
}

export type RazorpayRefund = {
  id: string
  payment_id: string
  amount: number
  status: 'pending' | 'processed' | 'failed' | string
  speed_processed?: string
  receipt?: string
}

export async function createRefund(input: CreateRefundInput): Promise<RazorpayRefund> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('amountPaise must be a positive integer')
  }

  return razorpayFetch<RazorpayRefund>(
    `/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
    {
      method: 'POST',
      idempotencyKey: input.refundReference,
      body: {
        amount: input.amountPaise,
        speed: 'normal',
        receipt: input.refundReference,
        notes: { tier: input.note ?? 'cancellation' },
      },
    },
  )
}

export async function getRefund(refundId: string): Promise<RazorpayRefund> {
  return razorpayFetch<RazorpayRefund>(`/refunds/${encodeURIComponent(refundId)}`, {
    method: 'GET',
  })
}

/**
 * Razorpay refund state -> our refund_status enum.
 *
 * `processed` is the settled state. `pending` means accepted and on its way —
 * still a real obligation, so it counts against the refundable balance.
 */
export function mapRefundStatus(status: string): ProviderRefundStatus {
  switch (status) {
    case 'processed':
      return 'success'
    case 'failed':
      return 'failed'
    case 'pending':
      return 'pending'
    default:
      return 'created'
  }
}
