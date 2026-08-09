import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { getBookingByReference } from '@/lib/booking/queries'
import { createServiceClient } from '@/lib/supabase/service'
import { getSettings } from '@/lib/settings'
import { formatDateLong, formatSlotLabel } from '@/lib/time/zone'
import { ReviewForm } from './_components/review-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Leave a review',
  robots: { index: false },
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ reference: string }>
}) {
  const { reference } = await params

  // The reference is the access token. Service-role read with no auth check.
  const booking = await getBookingByReference(reference)
  if (!booking) notFound()

  const settings = await getSettings()
  const starts = new Date(booking.startsAt)
  const ended = new Date(booking.endsAt).getTime() < Date.now()

  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('reviews')
    .select('id, rating, is_published')
    .eq('booking_id', booking.id)
    .maybeSingle()

  return (
    <>
      <PublicHeader />

      <section className="border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px]">
        <Link
          href={`/ticket/${booking.reference}`}
          className="mb-2 inline-block font-sans text-[12.5px] text-ink/50"
        >
          ‹ Back to ticket
        </Link>
        <h1 className="mb-1.5 font-serif text-[25px] font-light leading-[1.2] text-ink">
          Leave a review
        </h1>
        <p className="font-sans text-[13px] leading-[1.5] text-ink/60">
          {booking.companionName} · {formatDateLong(starts, settings.timezone)} ·{' '}
          {formatSlotLabel(starts, settings.timezone)} · {booking.areaName}
        </p>
      </section>

      <section className="px-[18px] py-5">
        {existing ? (
          <div className="rounded-[10px] border border-ink/15 bg-paper p-4">
            <p className="font-sans text-[14px] font-semibold text-ink">
              You have already reviewed this booking
            </p>
            <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink/60">
              {(existing as { is_published: boolean }).is_published
                ? 'It is live on his profile.'
                : 'We read every review before it goes on his profile, so it is not visible yet.'}
            </p>
          </div>
        ) : booking.status !== 'completed' || !ended ? (
          <div className="rounded-[10px] border border-ink/15 bg-paper p-4">
            <p className="font-sans text-[14px] font-semibold text-ink">
              This booking cannot be reviewed
            </p>
            <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink/60">
              {!ended
                ? 'The hour has not finished yet. Come back afterwards.'
                : 'Only a booking that ran and completed can be reviewed. A cancelled booking, or one that ended early, cannot.'}
            </p>
            <Link
              href={`/ticket/${booking.reference}`}
              className="mt-3 inline-block font-sans text-[12.5px] font-semibold text-blue"
            >
              Back to your booking
            </Link>
          </div>
        ) : (
          <ReviewForm bookingId={booking.id} reference={booking.reference} companionName={booking.companionName} />
        )}
      </section>
    </>
  )
}
