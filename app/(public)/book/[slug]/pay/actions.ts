'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentCustomer } from '@/lib/auth/session'
import { getSettings } from '@/lib/settings'
import { createOrder } from '@/lib/cashfree/orders'
import { bookingErrorMessage } from '@/lib/booking/errors'
import { getOwnBooking, isHoldLive } from '@/lib/booking/queries'

export type PayState = {
  error?: string
  /** Handed to the Cashfree JS SDK to open checkout. */
  paymentSessionId?: string
  expired?: boolean
}

const schema = z.object({
  bookingId: z.string().uuid(),
  termsVersion: z.string().min(1),
  accepted: z.literal('on', {
    errorMap: () => ({ message: 'Please accept the terms before paying.' }),
  }),
})

/**
 * Creates the Cashfree order and hands back a payment_session_id.
 *
 * This does NOT confirm anything. CLAUDE.md §3.3 — a booking becomes confirmed
 * on a verified webhook and nowhere else. All this does is open a checkout.
 */
export async function startPayment(
  _prev: PayState,
  formData: FormData,
): Promise<PayState> {
  const parsed = schema.safeParse({
    bookingId: formData.get('bookingId'),
    termsVersion: formData.get('termsVersion'),
    accepted: formData.get('accepted'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please accept the terms first.' }
  }

  const { bookingId, termsVersion } = parsed.data

  const customer = await getCurrentCustomer()
  if (!customer) return { error: bookingErrorMessage('AC_NOT_AUTHENTICATED') }

  const booking = await getOwnBooking(bookingId)
  if (!booking) return { error: bookingErrorMessage('AC_BOOKING_NOT_FOUND') }

  if (booking.status !== 'pending_payment') {
    return { error: 'This booking has already been paid for. Check your ticket.' }
  }
  if (!isHoldLive(booking)) {
    return { error: bookingErrorMessage('AC_HOLD_EXPIRED'), expired: true }
  }

  const settings = await getSettings()
  // The terms she ticked must be the ones the booking recorded. If either has
  // moved on, she has to read the current text before paying (§3.8).
  if (termsVersion !== settings.termsVersion || booking.termsVersion !== settings.termsVersion) {
    return { error: bookingErrorMessage('AC_TERMS_STALE') }
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL
  if (!site) return { error: 'Payments are not configured yet. Please call us to book.' }

  // A fresh order per attempt, so a retry after a decline is a new Cashfree
  // order against the same booking (PRD §6.6) rather than a reused one.
  const attempt = Date.now().toString(36).toUpperCase()
  const orderId = `${booking.reference}-${attempt}`

  // Service role: payments is service_role-only by policy (§3.9). The row is
  // written before the call so a successful order can never be orphaned.
  const service = createServiceClient()
  const { error: insertError } = await service.from('payments').insert({
    booking_id: booking.id,
    cashfree_order_id: orderId,
    amount_paise: booking.amountPaise,
    status: 'created',
  })
  if (insertError) {
    return { error: 'We could not start the payment. Nothing was charged — try again.' }
  }

  try {
    const order = await createOrder({
      orderId,
      // Straight off the booking row the RPC snapshotted. The browser never
      // supplied it and cannot influence it (§3.1).
      amountPaise: booking.amountPaise,
      bookingReference: booking.reference,
      customer: {
        id: customer.id,
        phone: customer.phone,
        name: customer.full_name,
      },
      returnUrl: `${site}/book/${booking.companionSlug}/pay/return?b=${booking.id}`,
      notifyUrl: `${site}/api/webhooks/cashfree`,
      expiresAt: new Date(booking.holdExpiresAt!),
    })

    await service
      .from('payments')
      .update({ payment_session_id: order.payment_session_id })
      .eq('cashfree_order_id', orderId)

    return { paymentSessionId: order.payment_session_id }
  } catch (error) {
    await service
      .from('payments')
      .update({ status: 'failed', failure_reason: 'order_create_failed' })
      .eq('cashfree_order_id', orderId)

    // Never "something went wrong" here — she needs to know her money did not
    // move (CLAUDE.md §6).
    return {
      error:
        'We could not reach the payment provider, so nothing was charged. Your slot is still held — try again, or call us.',
    }
  }
}
