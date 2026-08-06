'use server'

import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentCustomer } from '@/lib/auth/session'
import { getSettings } from '@/lib/settings'
import { createOrder } from '@/lib/payments/razorpay/orders'
import { ACTIVE_PROVIDER } from '@/lib/payments/provider'
import { bookingErrorMessage } from '@/lib/booking/errors'
import { getOwnBooking, isHoldLive } from '@/lib/booking/queries'

export type PayState = {
  error?: string
  /** Everything Checkout.js needs to open. Contains no secret. */
  order?: {
    orderId: string
    amountPaise: number
    keyId: string
    reference: string
    prefillName: string | null
    prefillEmail: string | null
    prefillContact: string | null
  }
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
 * Creates the Razorpay order and hands back what Checkout.js needs to open.
 *
 * This does NOT confirm anything. CLAUDE.md §3.3 — a booking becomes confirmed
 * on a verified webhook and nowhere else. All this does is open a checkout.
 *
 * The key id returned here is Razorpay's publishable key, which is designed to
 * be in the browser. The key secret never leaves the server.
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
  if (
    termsVersion !== settings.termsVersion ||
    booking.termsVersion !== settings.termsVersion
  ) {
    return { error: bookingErrorMessage('AC_TERMS_STALE') }
  }

  const keyId = process.env.RAZORPAY_KEY_ID?.trim()
  if (!keyId) {
    return { error: 'Payments are not configured yet. Please call us to book.' }
  }

  // A fresh receipt per attempt, so a retry after a decline is a new Razorpay
  // order against the same booking (PRD §6.6) rather than a reused one.
  // Razorpay caps receipt at 40 characters.
  const attempt = Date.now().toString(36).toUpperCase()
  const receipt = `${booking.reference}-${attempt}`.slice(0, 40)

  try {
    const order = await createOrder({
      receipt,
      // Straight off the booking row the RPC snapshotted. The browser never
      // supplied it and cannot influence it (§3.1).
      amountPaise: booking.amountPaise,
      bookingReference: booking.reference,
    })

    // Service role: payments is service_role-only by policy (§3.9). Written
    // AFTER the order exists, because Razorpay assigns the order id — there is
    // nothing to key the row on until it answers. If this insert fails, the
    // orphaned Razorpay order is simply never paid: it opens no checkout.
    const service = createServiceClient()
    const { error: insertError } = await service.from('payments').insert({
      booking_id: booking.id,
      payment_provider: ACTIVE_PROVIDER,
      provider_order_id: order.id,
      amount_paise: booking.amountPaise,
      status: 'created',
    })

    if (insertError) {
      return {
        error:
          'We could not start the payment, so nothing was charged. Your slot is still held — try again, or call us.',
      }
    }

    return {
      order: {
        orderId: order.id,
        amountPaise: booking.amountPaise,
        keyId,
        reference: booking.reference,
        prefillName: customer.full_name,
        prefillEmail: customer.email,
        prefillContact: customer.phone,
      },
    }
  } catch {
    // Never "something went wrong" here — she needs to know her money did not
    // move (CLAUDE.md §6).
    return {
      error:
        'We could not reach the payment provider, so nothing was charged. Your slot is still held — try again, or call us.',
    }
  }
}
