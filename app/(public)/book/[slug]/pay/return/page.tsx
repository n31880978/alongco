import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { bookingHasPaymentOrder, getBookingById, isHoldLive } from '@/lib/booking/queries'
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'
import { verifyCheckoutSignature } from '@/lib/payments/razorpay/verify'
import {
  reconcileCapturedCheckout,
  reconcileLatestPaymentAttempt,
} from '@/lib/payments/razorpay/reconcile'
import { PendingPoller } from './_components/pending-poller'
import { report } from '@/lib/observability/report'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Confirming your payment',
  robots: { index: false },
}

/**
 * Where the browser lands after checkout.
 *
 * CLAUDE.md §3.3: this page is a UX signal. It reads booking state and never
 * writes it — the webhook is what confirms. So the honest thing to show while
 * the webhook is in flight is "checking", not "confirmed".
 *
 * The Razorpay checkout handshake is verified here when present. That
 * verification decides only what she is TOLD — "we have your payment, we are
 * confirming it" versus "we did not see a completed payment". It never sets a
 * status. A forged signature therefore buys nothing: the booking still waits
 * for the webhook, and a genuine one that arrives before the webhook still
 * shows as pending rather than confirmed.
 */
export default async function PaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    b?: string
    checked?: string
    razorpay_order_id?: string
    razorpay_payment_id?: string
    razorpay_signature?: string
  }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const b = sp.b
  if (!b) notFound()

  // No auth required. Booking was already created.
  const booking = await getBookingById(b)
  if (!booking) notFound()

  // The webhook has landed. This is the only path to the ticket.
  if (booking.status === 'confirmed' || booking.status === 'completed') {
    redirect(`/ticket/${booking.reference}`)
  }

  if (booking.status === 'expired') {
    return (
      <>
        <PublicHeader back={{ href: `/book/${slug}`, label: 'Pick another time' }} />
        <section className="bg-white px-[18px] py-6">
          <div className="mb-4 rounded-xl border border-amber/20 bg-amber-tint px-4 py-3.5">
            <p className="mb-1 font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-amber">Hold expired</p>
            <p className="font-sans text-[13px] leading-[1.55] text-ink/75">
              The hold ran out before the payment landed.
            </p>
          </div>
          <h1 className="mb-2 font-serif text-[24px] font-light leading-[1.2] text-ink">
            That hold ran out before the payment landed
          </h1>
          <p className="mb-5 font-sans text-[13px] leading-[1.55] text-ink/65">
            If money did leave your account, it will be returned automatically — a payment
            against an expired hold is never captured by us. Call us on{' '}
            <a href={SUPPORT_PHONE_HREF} className="font-mono font-semibold text-ink underline underline-offset-2">
              {SUPPORT_PHONE}
            </a>{' '}
            with the reference{' '}
            <span className="font-mono font-semibold text-ink">{booking.reference}</span> and
            we will check it while you wait.
          </p>
          <Link
            href={`/book/${slug}`}
            className="flex h-[50px] items-center justify-center rounded-xl bg-ink font-sans text-[13.5px] font-semibold text-white"
          >
            Pick another time
          </Link>
        </section>
      </>
    )
  }

  const stillHeld = isHoldLive(booking)

  // Signal only — see the note above. Never a reason to change state.
  const signatureValid =
    Boolean(sp.razorpay_order_id && sp.razorpay_payment_id && sp.razorpay_signature) &&
    verifyCheckoutSignature(
      sp.razorpay_order_id!,
      sp.razorpay_payment_id!,
      sp.razorpay_signature!,
    )
  // A valid signature is necessary but not sufficient: the signed order must
  // be an order this booking actually created. This prevents a valid callback
  // from another booking being used to put this booking into a waiting state.
  const checkoutCompleted =
    signatureValid &&
    (await bookingHasPaymentOrder(booking.id, sp.razorpay_order_id!))

  // Webhooks normally complete this before the browser arrives. If they do
  // not, reconcile directly with Razorpay rather than leaving a real payment
  // in a perpetual "confirming" state.
  if (sp.checked !== '1') {
    try {
      const reconciliation = checkoutCompleted
        ? await reconcileCapturedCheckout({
            bookingId: booking.id,
            orderId: sp.razorpay_order_id!,
            paymentId: sp.razorpay_payment_id!,
          })
        : await reconcileLatestPaymentAttempt(booking.id)
      if (reconciliation === 'confirmed') redirect(`/ticket/${booking.reference}`)
      // Query Razorpay once per return visit. Further UI polling reads only our
      // database and leaves webhook delivery as the normal asynchronous path.
      redirect(`/book/${slug}/pay/return?b=${booking.id}&checked=1`)
    } catch (error) {
      // Next.js redirect() works by throwing a special NEXT_REDIRECT error.
      // Re-throw it so the redirect is honoured rather than caught as a failure.
      if (
        error instanceof Error &&
        (error.message === 'NEXT_REDIRECT' || (error as any).digest?.startsWith('NEXT_REDIRECT'))
      ) {
        throw error
      }
      report('payment', 'Razorpay reconciliation read failed', {
        severity: 'critical',
        error,
        context: { bookingId: booking.id },
      })
      redirect(`/book/${slug}/pay/return?b=${booking.id}&checked=1`)
    }
  }

  return (
    <>
      <PublicHeader back={{ href: `/ticket/${booking.reference}`, label: 'Your ticket' }} />
      <PendingPoller
        reference={booking.reference}
        stillHeld={stillHeld}
        checkoutCompleted={checkoutCompleted}
        retryHref={`/book/${slug}/pay?b=${booking.id}`}
      />
    </>
  )
}
