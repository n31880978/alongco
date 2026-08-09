import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { reportWebhookFailure } from '@/lib/observability/report'
import { getOrderPayments } from './orders'

/**
 * Reconcile a signed Checkout.js return against Razorpay's API.
 *
 * Webhooks remain the normal confirmation mechanism, but this closes the gap
 * when a webhook is delayed or misconfigured: Razorpay's authenticated API is
 * authoritative too. The browser can only invoke this after its signature has
 * already been verified by the caller; every value is then cross-checked again
 * against our payment row and Razorpay's captured payment.
 */
export async function reconcileCapturedCheckout({
  bookingId,
  orderId,
  paymentId,
}: {
  bookingId: string
  orderId: string
  paymentId: string
}): Promise<'confirmed' | 'pending' | 'mismatch'> {
  const payments = await getOrderPayments(orderId)
  const captured = payments.find(
    (payment) =>
      payment.id === paymentId &&
      payment.order_id === orderId &&
      payment.status === 'captured',
  )
  if (!captured) return 'pending'

  const supabase = createServiceClient()
  const { data: paymentRow, error: lookupError } = await supabase
    .from('payments')
    .select('id, amount_paise')
    .eq('booking_id', bookingId)
    .eq('payment_provider', 'razorpay')
    .eq('provider_order_id', orderId)
    .maybeSingle()

  if (lookupError || !paymentRow || paymentRow.amount_paise !== captured.amount) {
    return 'mismatch'
  }

  return recordCapturedPayment(supabase, paymentRow.id, bookingId, captured)
}

/**
 * Recovery path for an older return URL that lost the Checkout.js response.
 * The order is selected only from our own payment records, then checked with
 * Razorpay; no browser-supplied payment id is trusted here.
 */
export async function reconcileLatestPaymentAttempt(
  bookingId: string,
): Promise<'confirmed' | 'pending' | 'mismatch'> {
  const supabase = createServiceClient()
  const { data: paymentRow, error } = await supabase
    .from('payments')
    .select('id, provider_order_id, amount_paise')
    .eq('booking_id', bookingId)
    .eq('payment_provider', 'razorpay')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !paymentRow) return 'mismatch'

  const payments = await getOrderPayments(paymentRow.provider_order_id)
  const captured = payments.find(
    (payment) =>
      payment.order_id === paymentRow.provider_order_id &&
      payment.status === 'captured' &&
      payment.amount === paymentRow.amount_paise,
  )
  if (!captured) return 'pending'
  return recordCapturedPayment(supabase, paymentRow.id, bookingId, captured)
}

async function recordCapturedPayment(
  supabase: ReturnType<typeof createServiceClient>,
  paymentRowId: string,
  bookingId: string,
  captured: { id: string; method?: string },
): Promise<'confirmed' | 'mismatch'> {

  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'captured',
      provider_payment_id: captured.id,
      method: typeof captured.method === 'string' ? captured.method : null,
      captured_at: new Date().toISOString(),
      failure_reason: null,
    })
    .eq('id', paymentRowId)

  if (updateError) throw new Error('could not record reconciled Razorpay payment')

  const { error: statusError } = await supabase.rpc('ac_set_booking_status', {
    p_booking_id: bookingId,
    p_to: 'confirmed',
    p_actor_type: 'system',
    p_actor_id: null,
    p_reason: 'payment captured — Razorpay API reconciliation',
  })

  // A late payment cannot be confirmed if its held slot was resold. The
  // webhook path records this for refund handling; do not mislead the customer
  // by reporting a confirmed ticket here.
  if (statusError) {
    // Never leave an impossible-to-confirm captured payment silent. The event
    // is durable for operators, and the alert carries no customer data.
    await supabase.from('booking_events').insert({
      booking_id: bookingId,
      from_status: null,
      to_status: 'expired',
      actor_type: 'system',
      reason: 'payment captured during Razorpay API reconciliation — manual refund review required',
    })
    reportWebhookFailure(
      'Razorpay API reconciliation captured a payment but could not confirm the booking — REFUND REVIEW REQUIRED',
      { bookingId },
      statusError,
    )
    return 'mismatch'
  }
  return 'confirmed'
}
