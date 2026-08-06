import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { report, reportWebhookFailure } from '@/lib/observability/report'
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyWebhookSignature,
  webhookEventId,
  type CashfreeWebhookPayload,
} from '@/lib/cashfree/verify'
import { paymentMethodName } from '@/lib/cashfree/orders'
import { mapRefundStatus } from '@/lib/cashfree/refunds'

/**
 * The Cashfree webhook. CLAUDE.md §3.3, §3.4 and PRD §6.6.
 *
 * This is the ONLY thing in the system that sets a booking to `confirmed`. The
 * browser redirect after checkout is a UX signal and never touches state.
 *
 * Three properties this must hold:
 *   1. The signature is verified against the RAW body before anything is read.
 *   2. Processing is idempotent, keyed on the provider event id in
 *      webhook_events — Cashfree retries, and it must confirm exactly once.
 *   3. A payment completed with the browser closed still confirms, because
 *      nothing here depends on the customer's session.
 */

// Node runtime: signature verification needs node:crypto and the raw body.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Must be the exact bytes Cashfree signed. Parsing first and re-serialising
  // would change key order and break the HMAC.
  const rawBody = await request.text()

  const verification = verifyWebhookSignature(
    rawBody,
    request.headers.get(SIGNATURE_HEADER),
    request.headers.get(TIMESTAMP_HEADER),
  )

  if (!verification.ok) {
    // Logged without the payload — it carries customer details (§9).
    report('webhook', 'signature verification failed', {
      severity: 'warning',
      context: { reason: verification.reason },
    })
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: CashfreeWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const eventId = webhookEventId(payload)
  if (!eventId) {
    report('webhook', 'webhook without an identifiable event', {
      severity: 'warning',
      context: { type: payload.type },
    })
    return NextResponse.json({ error: 'unidentifiable event' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // The idempotency gate. The unique index on (provider, event_id) makes this a
  // race-safe claim: a concurrent redelivery loses the insert and returns here.
  const { error: claimError } = await supabase.from('webhook_events').insert({
    provider: 'cashfree',
    event_id: eventId,
    event_type: payload.type ?? 'unknown',
    payload: payload as unknown as Record<string, unknown>,
  })

  if (claimError) {
    // 23505 = unique violation: already seen. Acknowledge so Cashfree stops.
    if ((claimError as { code?: string }).code === '23505') {
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }
    reportWebhookFailure('could not record webhook event', { eventId }, claimError)
    // 500 so Cashfree retries — losing the event is worse than a retry.
    return NextResponse.json({ error: 'storage failure' }, { status: 500 })
  }

  try {
    await handleEvent(supabase, payload)
    await supabase
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'cashfree')
      .eq('event_id', eventId)

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (error) {
    // Record why, then ask for a retry. processed_at stays null so the failure
    // is visible in admin rather than silently swallowed.
    await supabase
      .from('webhook_events')
      .update({
        process_error: error instanceof Error ? error.message : 'unknown error',
      })
      .eq('provider', 'cashfree')
      .eq('event_id', eventId)

    // A payment Cashfree captured that we failed to apply: she has paid and
    // her booking is not confirmed. This is the page-someone case.
    reportWebhookFailure('webhook processing failed', { eventId }, error)
    return NextResponse.json({ error: 'processing failed' }, { status: 500 })
  }
}

type Service = ReturnType<typeof createServiceClient>

async function handleEvent(supabase: Service, payload: CashfreeWebhookPayload) {
  const type = payload.type ?? ''

  if (type.startsWith('PAYMENT_SUCCESS')) return handlePaymentSuccess(supabase, payload)
  if (type.startsWith('PAYMENT_FAILED') || type.startsWith('PAYMENT_USER_DROPPED')) {
    return handlePaymentFailed(supabase, payload)
  }
  if (type.startsWith('REFUND_STATUS')) return handleRefundStatus(supabase, payload)

  // Anything else is recorded and acknowledged, not acted on.
}

async function handlePaymentSuccess(
  supabase: Service,
  payload: CashfreeWebhookPayload,
) {
  const orderId = payload.data?.order?.order_id
  const payment = payload.data?.payment
  if (!orderId || !payment) throw new Error('payment success without an order')

  const { data: paymentRow, error } = await supabase
    .from('payments')
    .select('id, booking_id, amount_paise, status')
    .eq('cashfree_order_id', orderId)
    .maybeSingle()

  if (error) throw new Error('payment lookup failed')
  if (!paymentRow) throw new Error('no payment row for order')

  // Guard against a payload that claims a different amount than we asked for.
  // Cashfree reports rupees; compare in paise so no float rounding decides this.
  const reportedPaise = Math.round(Number(payment.payment_amount ?? 0) * 100)
  if (reportedPaise !== paymentRow.amount_paise) {
    throw new Error('payment amount does not match the booking')
  }

  await supabase
    .from('payments')
    .update({
      status: 'captured',
      cashfree_payment_id: String(payment.cf_payment_id ?? ''),
      method: paymentMethodName(payment.payment_method),
      captured_at: payment.payment_time ?? new Date().toISOString(),
    })
    .eq('id', paymentRow.id)

  // ac_set_booking_status is itself idempotent — a repeat is a no-op and writes
  // no second booking_events row.
  const { error: statusError } = await supabase.rpc('ac_set_booking_status', {
    p_booking_id: paymentRow.booking_id,
    p_to: 'confirmed',
    p_actor_type: 'system',
    p_actor_id: null,
    p_reason: 'payment captured',
  })

  if (statusError) {
    // The hold expired while she was paying AND the slot was resold in the
    // meantime, so confirming would double-book the companion. The exclusion
    // constraint (23P01) is what stops it, and it is right to stop it.
    //
    // Her money is captured and recorded. Retrying can never succeed, so this
    // acknowledges the webhook rather than looping Cashfree forever, and pages
    // an operator to refund her in full — this failure is ours, not hers.
    if ((statusError as { code?: string }).code === '23P01') {
      await supabase
        .from('booking_events')
        .insert({
          booking_id: paymentRow.booking_id,
          from_status: null,
          to_status: 'expired',
          actor_type: 'system',
          reason:
            'payment captured after the hold expired and the slot was resold — full refund owed',
        })

      reportWebhookFailure(
        'payment captured for an expired booking whose slot was resold — REFUND OWED',
        { bookingId: paymentRow.booking_id, amountPaise: paymentRow.amount_paise },
        statusError,
      )
      return
    }

    throw new Error('could not confirm booking')
  }
}

async function handlePaymentFailed(supabase: Service, payload: CashfreeWebhookPayload) {
  const orderId = payload.data?.order?.order_id
  const payment = payload.data?.payment
  if (!orderId) throw new Error('payment failure without an order')

  // The booking stays `pending_payment` so she can retry inside the hold
  // window and resume the same booking (PRD §6.6).
  await supabase
    .from('payments')
    .update({
      status: 'failed',
      cashfree_payment_id: payment?.cf_payment_id
        ? String(payment.cf_payment_id)
        : null,
      method: paymentMethodName(payment?.payment_method),
      failure_reason: payment?.payment_status ?? 'failed',
    })
    .eq('cashfree_order_id', orderId)
}

async function handleRefundStatus(supabase: Service, payload: CashfreeWebhookPayload) {
  const refund = payload.data?.refund
  const reference = refund?.refund_id
  if (!reference) throw new Error('refund event without a reference')

  const status = mapRefundStatus(String(refund?.refund_status ?? ''))

  await supabase
    .from('refunds')
    .update({
      status,
      cashfree_refund_id: refund?.cf_refund_id ? String(refund.cf_refund_id) : null,
      settled_at: status === 'success' ? new Date().toISOString() : null,
    })
    .eq('refund_reference', reference)
}

/** Cashfree probes the endpoint when the webhook is configured. */
export async function GET() {
  return NextResponse.json({ status: 'ready' }, { status: 200 })
}
