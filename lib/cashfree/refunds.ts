import 'server-only'
import { cashfreeFetch } from './client'
import { paiseToRupees } from '@/lib/booking/pricing'

/**
 * Refunds. PRD §6.9.
 *
 * `refundReference` is our own idempotent id, stored on the refunds row before
 * the call. If this request times out and is retried, Cashfree matches the same
 * refund_id and does not issue a second one — which is what keeps
 * "a refund can never exceed the captured amount" true across retries.
 *
 * The amount comes from ac_refund_quote(), which caps at what is still
 * refundable. It is never computed in the UI.
 */

export type CreateRefundInput = {
  cashfreeOrderId: string
  refundReference: string
  amountPaise: number
  /** Settlement-report visible. Tier code only — never a name or a number (§9). */
  note?: string
}

export type CashfreeRefund = {
  cf_refund_id: string | number
  refund_id: string
  order_id: string
  refund_status: 'SUCCESS' | 'PENDING' | 'CANCELLED' | 'ONHOLD' | 'FAILED' | string
  refund_amount: number
  processed_at?: string
}

export async function createRefund(input: CreateRefundInput): Promise<CashfreeRefund> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('amountPaise must be a positive integer')
  }

  return cashfreeFetch<CashfreeRefund>(
    `/orders/${encodeURIComponent(input.cashfreeOrderId)}/refunds`,
    {
      method: 'POST',
      idempotencyKey: input.refundReference,
      body: {
        refund_id: input.refundReference,
        refund_amount: paiseToRupees(input.amountPaise),
        refund_note: input.note ?? 'AlongCo cancellation',
        refund_speed: 'STANDARD',
      },
    },
  )
}

export async function getRefund(
  cashfreeOrderId: string,
  refundReference: string,
): Promise<CashfreeRefund> {
  return cashfreeFetch<CashfreeRefund>(
    `/orders/${encodeURIComponent(cashfreeOrderId)}/refunds/${encodeURIComponent(refundReference)}`,
    { method: 'GET' },
  )
}

/** Cashfree refund status -> our refund_status enum. */
export function mapRefundStatus(
  status: string,
): 'created' | 'pending' | 'success' | 'failed' {
  switch (status?.toUpperCase()) {
    case 'SUCCESS':
      return 'success'
    case 'FAILED':
    case 'CANCELLED':
      return 'failed'
    case 'PENDING':
    case 'ONHOLD':
      return 'pending'
    default:
      return 'created'
  }
}
