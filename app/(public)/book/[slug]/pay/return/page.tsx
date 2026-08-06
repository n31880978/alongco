import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { getOwnBooking, isHoldLive } from '@/lib/booking/queries'
import { getCurrentCustomer } from '@/lib/auth/session'
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'
import { PendingPoller } from './_components/pending-poller'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Confirming your payment',
  robots: { index: false },
}

/**
 * Where Cashfree sends the browser after checkout.
 *
 * CLAUDE.md §3.3: this page is a UX signal. It reads booking state and never
 * writes it — the webhook is what confirms. So the honest thing to show while
 * the webhook is in flight is "checking", not "confirmed".
 */
export default async function PaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ b?: string }>
}) {
  const { slug } = await params
  const { b } = await searchParams
  if (!b) notFound()

  const customer = await getCurrentCustomer()
  if (!customer) {
    redirect(`/sign-in?next=${encodeURIComponent(`/book/${slug}/pay/return?b=${b}`)}`)
  }

  const booking = await getOwnBooking(b)
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
          <h1 className="mb-2 font-serif text-[21px] font-light leading-[1.25] text-ink">
            That hold ran out before the payment landed
          </h1>
          <p className="mb-4 font-sans text-[13px] leading-[1.5] text-ink/65">
            If money did leave your account, it will be returned automatically — a payment
            against an expired hold is never captured by us. Call us on{' '}
            <a href={SUPPORT_PHONE_HREF} className="font-mono font-medium text-ink">
              {SUPPORT_PHONE}
            </a>{' '}
            with the reference{' '}
            <span className="font-mono font-medium text-ink">{booking.reference}</span> and
            we will check it while you wait.
          </p>
          <Link
            href={`/book/${slug}`}
            className="flex h-[46px] items-center justify-center rounded-lg bg-ink font-sans text-[13.5px] font-semibold text-white"
          >
            Pick another time
          </Link>
        </section>
      </>
    )
  }

  const stillHeld = isHoldLive(booking)

  return (
    <>
      <PublicHeader back={{ href: '/bookings', label: 'Your bookings' }} />
      <PendingPoller
        reference={booking.reference}
        stillHeld={stillHeld}
        retryHref={`/book/${slug}/pay?b=${booking.id}`}
      />
    </>
  )
}
