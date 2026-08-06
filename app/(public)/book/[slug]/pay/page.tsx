import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { HoldTimer } from '@/components/site/hold-timer'
import { Portrait } from '@/components/site/companion-card'
import { getOwnBooking, isHoldLive } from '@/lib/booking/queries'
import { getCurrentCustomer } from '@/lib/auth/session'
import { getCompanion } from '@/lib/companions'
import { getSettings } from '@/lib/settings'
import { formatPaise, quote } from '@/lib/booking/pricing'
import { CONDUCT_TERMS } from '@/lib/booking/terms'
import { formatSlotLabel, formatDateShort } from '@/lib/time/zone'
import { HoldExpired } from '../_components/hold-expired'
import { Checkout } from './_components/checkout'
import { TrackView } from '@/components/analytics/ga'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Review and pay',
  robots: { index: false },
}

export default async function PayPage({
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
    redirect(`/sign-in?next=${encodeURIComponent(`/book/${slug}/pay?b=${b}`)}`)
  }

  const booking = await getOwnBooking(b)
  if (!booking) notFound()
  if (booking.status !== 'pending_payment') redirect(`/ticket/${booking.reference}`)

  const [companion, settings] = await Promise.all([getCompanion(slug), getSettings()])
  if (!companion) notFound()

  if (!isHoldLive(booking)) {
    return (
      <>
        <PublicHeader back={{ href: `/book/${slug}`, label: companion.displayName }} />
        <HoldExpired slug={slug} />
      </>
    )
  }

  const minutes = Math.round(
    (new Date(booking.endsAt).getTime() - new Date(booking.startsAt).getTime()) / 60000,
  )
  const hours = minutes / 60
  const priced = quote(
    booking.rateSnapshotPaise ?? companion.hourlyRatePaise,
    minutes,
    settings.durationDiscounts,
  )

  return (
    <>
      <TrackView event="begin_checkout" />
      <PublicHeader
        back={{ href: `/book/${slug}/details?b=${booking.id}`, label: 'Your details' }}
      />
      <HoldTimer expiresAt={booking.holdExpiresAt!} />

      {/* What you are paying for */}
      <section className="border-b border-ink/10 bg-white px-[18px] pb-4 pt-[18px]">
        <h1 className="mb-3.5 font-serif text-[24px] font-light leading-[1.2] text-ink">
          What you are paying for
        </h1>

        <div className="mb-3.5 flex items-center gap-3">
          <Portrait
            url={companion.photoUrl}
            name={companion.displayName}
            className="h-[52px] w-[52px]"
            sizes="52px"
          />
          <div>
            <div className="font-sans text-[14.5px] font-semibold text-ink">
              {companion.displayName}
            </div>
            <div className="mt-[3px] font-mono text-[10.5px] font-medium uppercase text-ink/50">
              {formatDateShort(new Date(booking.startsAt), settings.timezone)} ·{' '}
              {formatSlotLabel(new Date(booking.startsAt), settings.timezone)}–
              {formatSlotLabel(new Date(booking.endsAt), settings.timezone)} ·{' '}
              {booking.areaName}
            </div>
          </div>
        </div>

        <dl className="border-t border-ink/10">
          <Row
            label={`${hours} hour${hours === 1 ? '' : 's'} at ${formatPaise(
              booking.rateSnapshotPaise ?? companion.hourlyRatePaise,
            )}`}
            value={formatPaise(priced.grossPaise)}
          />
          <Row
            label="Duration discount"
            value={
              booking.discountPercent > 0
                ? `−${formatPaise(priced.savingPaise)}`
                : '—'
            }
            muted={booking.discountPercent === 0}
          />
          <div className="flex items-baseline justify-between pt-[13px]">
            <dt className="font-sans text-[14px] font-semibold text-ink">Total due now</dt>
            {/* The snapshotted amount. This is exactly what Cashfree is asked for. */}
            <dd className="font-mono text-[22px] font-bold text-ink">
              {formatPaise(booking.amountPaise)}
            </dd>
          </div>
        </dl>
      </section>

      <Checkout
        bookingId={booking.id}
        slug={slug}
        reference={booking.reference}
        termsVersion={settings.termsVersion}
        clauses={CONDUCT_TERMS.clauses}
        amountLabel={formatPaise(booking.amountPaise)}
      />
    </>
  )
}

function Row({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex justify-between border-b border-ink/[.06] py-[11px]">
      <dt className="font-sans text-[13.5px] text-ink/70">{label}</dt>
      <dd
        className={`font-mono text-[13.5px] font-semibold ${muted ? 'text-ink/45' : 'text-ink'}`}
      >
        {value}
      </dd>
    </div>
  )
}
