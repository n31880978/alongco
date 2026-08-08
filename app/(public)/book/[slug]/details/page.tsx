import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { HoldTimer } from '@/components/site/hold-timer'
import { getOwnBooking, isHoldLive } from '@/lib/booking/queries'
import { getCurrentCustomer } from '@/lib/auth/session'
import { getCompanion } from '@/lib/companions'
import { formatPaise } from '@/lib/booking/pricing'
import { maskEmail } from '@/lib/utils'
import { HoldExpired } from '../_components/hold-expired'
import { DetailsForm } from './_components/details-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your details',
  robots: { index: false },
}

export default async function DetailsPage({
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
    redirect(`/sign-in?next=${encodeURIComponent(`/book/${slug}/details?b=${b}`)}`)
  }

  // RLS scopes this to her own bookings, so another customer's id is a 404.
  const booking = await getOwnBooking(b)
  if (!booking) notFound()

  if (booking.status !== 'pending_payment') {
    // Already paid, or cancelled while she was away — send her to the record.
    redirect(`/ticket/${booking.reference}`)
  }

  const companion = await getCompanion(slug)
  if (!companion) notFound()

  if (!isHoldLive(booking)) {
    return (
      <>
        <PublicHeader back={{ href: `/book/${slug}`, label: companion.displayName }} />
        <HoldExpired slug={slug} />
      </>
    )
  }

  const areas = companion.areaIds.map((id, i) => ({ id, name: companion.areas[i] }))

  return (
    <>
      <PublicHeader
        back={{ href: `/book/${slug}`, label: companion.displayName }}
      />
      <HoldTimer expiresAt={booking.holdExpiresAt!} />

      <section className="border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px]">
        <h1 className="mb-[5px] font-serif text-[24px] font-light leading-[1.2] text-ink">
          Three things, and nothing else
        </h1>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
          We ask for the minimum the booking needs. No address, no photo.
        </p>
      </section>

      <DetailsForm
        slug={slug}
        bookingId={booking.id}
        maskedEmail={maskEmail(customer.email ?? '')}
        defaultName={customer.full_name ?? ''}
        defaultPhone={customer.phone ?? ''}
        defaultAreaId={booking.areaId}
        defaultNotes={booking.customerNotes ?? ''}
        areas={areas}
        companionName={companion.displayName}
        amountLabel={formatPaise(booking.amountPaise)}
        alreadyConsented={Boolean(customer.consent_at)}
      />
    </>
  )
}
