import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { listOwnBookings, type BookingView } from '@/lib/booking/queries'
import { getCurrentCustomer } from '@/lib/auth/session'
import { getSettings } from '@/lib/settings'
import { formatPaise } from '@/lib/booking/pricing'
import { formatDateLong, formatSlotLabel } from '@/lib/time/zone'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your bookings',
  robots: { index: false },
}

export default async function BookingsPage() {
  const customer = await getCurrentCustomer()
  if (!customer) redirect('/sign-in?next=/bookings')

  const [bookings, settings] = await Promise.all([listOwnBookings(), getSettings()])
  const now = Date.now()

  const upcoming = bookings.filter(
    (b) =>
      new Date(b.startsAt).getTime() >= now &&
      ['pending_payment', 'confirmed'].includes(b.status),
  )
  const past = bookings.filter((b) => !upcoming.includes(b))

  return (
    <>
      <PublicHeader />

      <section className="border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px]">
        <h1 className="mb-1.5 font-serif text-[25px] font-light leading-[1.2] text-ink">
          Your bookings
        </h1>
        <p className="font-sans text-[13px] leading-[1.5] text-ink/60">
          Every ticket you have, with its reference. Nothing here is shared with anyone
          else.
        </p>
      </section>

      {bookings.length === 0 ? (
        <section className="px-[18px] py-5">
          <div className="rounded-lg border border-dashed border-ink/20 bg-paper p-5 text-center">
            <p className="mb-1.5 font-sans text-[14px] font-semibold text-ink">
              Nothing booked yet
            </p>
            <p className="mb-3 font-sans text-[12.5px] leading-[1.5] text-ink/60">
              When you book an hour, the ticket appears here and stays after the meeting.
            </p>
            <Link
              href="/companions"
              className="font-sans text-[12.5px] font-semibold text-blue"
            >
              See who is free
            </Link>
          </div>
        </section>
      ) : (
        <>
          {upcoming.length > 0 && (
            <Group title="COMING UP">
              {upcoming.map((b) => (
                <BookingRow key={b.id} booking={b} timezone={settings.timezone} />
              ))}
            </Group>
          )}
          {past.length > 0 && (
            <Group title="EARLIER">
              {past.map((b) => (
                <BookingRow key={b.id} booking={b} timezone={settings.timezone} />
              ))}
            </Group>
          )}
        </>
      )}
    </>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-[18px] py-4">
      <h2 className="mb-2.5 font-mono text-[9px] font-semibold tracking-[0.12em] text-ink/45">
        {title}
      </h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}

function BookingRow({
  booking,
  timezone,
}: {
  booking: BookingView
  timezone: string
}) {
  const starts = new Date(booking.startsAt)
  const ends = new Date(booking.endsAt)
  const unpaid = booking.status === 'pending_payment'

  // An unpaid hold has no ticket to show yet — send her back to finish paying.
  const href = unpaid
    ? `/book/${booking.companionSlug}/pay?b=${booking.id}`
    : `/ticket/${booking.reference}`

  // A review is only offered once the hour actually ran (PRD §6.10). Offering
  // it on a cancelled booking would be an invitation the database then refuses.
  const reviewable = booking.status === 'completed' && ends.getTime() < Date.now()

  return (
    <div className="rounded-[10px] border border-ink/10 bg-white shadow-[0_1px_3px_rgba(22,22,26,.05)]">
      <Link href={href} className="block p-3.5">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="font-sans text-[15px] font-semibold text-ink">
            {booking.companionName}
          </span>
          <StatusTag status={booking.status} />
        </div>
        <div className="mb-1.5 font-mono text-[10.5px] font-medium uppercase text-ink/50">
          {formatDateLong(starts, timezone)} · {formatSlotLabel(starts, timezone)}–
          {formatSlotLabel(ends, timezone)} · {booking.areaName}
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[11px] font-semibold text-ink/45">
            {booking.reference}
          </span>
          <span className="font-mono text-[13px] font-semibold text-ink">
            {formatPaise(booking.amountPaise)}
          </span>
        </div>
      </Link>

      {reviewable && (
        <Link
          href={`/review/${booking.reference}`}
          className="block border-t border-ink/10 px-3.5 py-2.5 font-sans text-[12.5px] font-semibold text-blue"
        >
          Leave a review →
        </Link>
      )}
    </div>
  )
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending_payment: { label: 'NOT PAID YET', className: 'bg-amber-tint text-amber' },
    confirmed: { label: 'CONFIRMED', className: 'bg-green-tint text-green' },
    completed: { label: 'COMPLETED', className: 'bg-green-tint text-green' },
    expired: { label: 'HOLD LAPSED', className: 'bg-paper-sunk text-ink/45' },
    cancelled_by_customer: {
      label: 'CANCELLED',
      className: 'bg-paper-sunk text-ink/45',
    },
    cancelled_by_admin: { label: 'CANCELLED BY US', className: 'bg-rose-tint text-rose-deep' },
    ended_early: { label: 'ENDED EARLY', className: 'bg-rose-tint text-rose-deep' },
    no_show_customer: { label: 'MISSED', className: 'bg-paper-sunk text-ink/45' },
    no_show_companion: {
      label: 'HE DID NOT ARRIVE',
      className: 'bg-rose-tint text-rose-deep',
    },
  }
  const tag = map[status] ?? {
    label: status.replace(/_/g, ' ').toUpperCase(),
    className: 'bg-paper-sunk text-ink/45',
  }

  return (
    <span
      className={cn(
        'shrink-0 rounded-[3px] px-1.5 py-1 font-mono text-[9px] font-semibold',
        tag.className,
      )}
    >
      {tag.label}
    </span>
  )
}
