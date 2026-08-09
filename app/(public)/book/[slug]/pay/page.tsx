import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { HoldTimer } from '@/components/site/hold-timer'
import { Portrait } from '@/components/site/companion-card'
import { getBookingById, isHoldLive } from '@/lib/booking/queries'
import { getCompanion } from '@/lib/companions'
import { getSettings } from '@/lib/settings'
import { formatPaise, quote } from '@/lib/booking/pricing'
import { CONDUCT_TERMS } from '@/lib/booking/terms'
import { formatSlotLabel, formatDateShort } from '@/lib/time/zone'
import { HoldExpired } from '../_components/hold-expired'
import { Checkout } from './_components/checkout'
import { TrackView } from '@/components/analytics/ga'
import { StepBar } from '../_components/step-bar'

// Step 4 of 4 in the booking journey

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

  const booking = await getBookingById(b)
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

  const startDate = new Date(booking.startsAt)
  const endDate = new Date(booking.endsAt)

  return (
    <>
      <TrackView event="begin_checkout" />
      <PublicHeader back={{ href: `/book/${slug}`, label: 'Pick your slot' }} />
      <HoldTimer expiresAt={booking.holdExpiresAt!} />

      <section className="border-b border-ink/10 bg-white px-[18px] pb-5 pt-5">
        <StepBar current={4} />

        <h1 className="mb-1.5 mt-5 font-serif text-[28px] font-light leading-[1.15] text-ink">
          Review &amp; pay
        </h1>
        <p className="font-sans text-[13px] leading-[1.55] text-ink/55">
          Nothing is charged until you complete the secure checkout.
        </p>
      </section>

      {/* Booking summary */}
      <section className="border-b border-ink/10 bg-white px-[18px] pb-5 pt-4">
        <div className="mb-3 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink/40">
          What you're booking
        </div>

        <div className="flex items-center gap-3.5">
          <Portrait
            url={companion.photoUrl}
            name={companion.displayName}
            className="h-[56px] w-[56px] shrink-0"
            sizes="56px"
          />
          <div className="min-w-0 flex-1">
            <p className="font-sans text-[15px] font-semibold text-ink">
              {companion.displayName}
            </p>
            <p className="mt-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.05em] text-ink/50">
              {formatDateShort(startDate, settings.timezone)}
            </p>
            <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.05em] text-ink/50">
              {formatSlotLabel(startDate, settings.timezone)}–{formatSlotLabel(endDate, settings.timezone)} · {booking.areaName}
            </p>
          </div>
        </div>

        {/* Price breakdown */}
        <div className="mt-4 overflow-hidden rounded-xl border border-ink/10">
          <PriceRow
            label={`${hours} hour${hours === 1 ? '' : 's'} at ${formatPaise(booking.rateSnapshotPaise ?? companion.hourlyRatePaise)}/hr`}
            value={formatPaise(priced.grossPaise)}
          />
          {booking.discountPercent > 0 && (
            <PriceRow
              label={`Duration discount (${booking.discountPercent}%)`}
              value={`−${formatPaise(priced.savingPaise)}`}
              muted
              accent="green"
            />
          )}
          <div className="flex items-center justify-between bg-ink px-4 py-3.5">
            <span className="font-sans text-[13.5px] font-semibold text-white/80">Total due now</span>
            <span className="font-mono text-[20px] font-bold text-white">
              {formatPaise(booking.amountPaise)}
            </span>
          </div>
        </div>
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

function PriceRow({
  label,
  value,
  muted,
  accent,
}: {
  label: string
  value: string
  muted?: boolean
  accent?: 'green'
}) {
  return (
    <div className="flex items-center justify-between border-b border-ink/[.06] bg-white px-4 py-3">
      <span className="font-sans text-[13px] text-ink/65">{label}</span>
      <span
        className={
          accent === 'green'
            ? 'font-mono text-[13px] font-semibold text-green'
            : muted
              ? 'font-mono text-[13px] font-semibold text-ink/40'
              : 'font-mono text-[13px] font-semibold text-ink'
        }
      >
        {value}
      </span>
    </div>
  )
}
