import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { Aurora } from '@/components/brand/aurora'
import { Wordmark } from '@/components/brand/mark'
import { getOwnBookingByReference } from '@/lib/booking/queries'
import { getCurrentCustomer } from '@/lib/auth/session'
import { getSettings } from '@/lib/settings'
import { formatPaise } from '@/lib/booking/pricing'
import { CONDUCT_SUMMARY } from '@/lib/booking/terms'
import { formatDateLong, formatSlotLabel } from '@/lib/time/zone'
import { SERVICE_HOURS_SHORT, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'
import { Ticket } from './_components/ticket'
import { TrackView } from '@/components/analytics/ga'

// A ticket is private and per-customer. Never prerendered, never shared-cached
// (see the no-store header for /ticket/* in next.config.ts).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your ticket',
  robots: { index: false, follow: false },
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ reference: string }>
}) {
  const { reference } = await params

  const customer = await getCurrentCustomer()
  if (!customer) {
    redirect(`/sign-in?next=${encodeURIComponent(`/ticket/${reference}`)}`)
  }

  // RLS scopes bookings to the caller, so another customer's reference simply
  // returns nothing — which is the 404 required by PRD §6.7, not a 403 that
  // would confirm the reference exists.
  const booking = await getOwnBookingByReference(reference)
  if (!booking) notFound()

  // A ticket exists once payment is captured. Before that there is nothing to show.
  if (booking.status === 'pending_payment' || booking.status === 'expired') {
    redirect(`/book/${booking.companionSlug}/pay/return?b=${booking.id}`)
  }

  const settings = await getSettings()
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://alongco.com'

  // The QR is the identity handshake at the meeting, since his real name is
  // never shown (PRD §6.7). It encodes the reference URL and nothing else — no
  // name, no phone number.
  const qrDataUrl = await QRCode.toDataURL(`${site}/t/${booking.reference}`, {
    margin: 0,
    width: 264,
    errorCorrectionLevel: 'M',
    color: { dark: '#23231F', light: '#FCFAF300' },
  })

  const starts = new Date(booking.startsAt)
  const ends = new Date(booking.endsAt)
  const minutes = Math.round((ends.getTime() - starts.getTime()) / 60000)
  const hours = minutes / 60

  const cancelled = booking.status.startsWith('cancelled')

  return (
    <div className="relative overflow-hidden bg-ink-deep">
      {/* Closes the funnel: PRD §10 measures median profile → ticket. Only a
          real, non-cancelled ticket counts as a conversion. */}
      {!cancelled && (
        <TrackView event="booking_confirmed" companionSlug={booking.companionSlug} />
      )}
      <Aurora variant="dark" />

      <div className="relative px-5 pb-2 pt-[18px]">
        <div className="mb-[18px] flex items-center justify-between">
          <Wordmark size={24} tone="paper" />
          <StatusPill status={booking.status} />
        </div>
        <h1 className="mb-1.5 animate-fade font-serif text-[25px] font-light leading-[1.2] text-white">
          {cancelled ? 'This booking was cancelled.' : 'Your hour is booked.'}
        </h1>
        <p className="mb-1.5 animate-fade font-sans text-[13px] leading-[1.5] text-white/55 [animation-delay:.1s]">
          {cancelled
            ? 'Keep this record. Any refund due follows the refund policy and appears on your original payment method.'
            : `Keep this ticket. We will message you on WhatsApp within ${settings.confirmationSlaMinutes} minutes with the meeting details.`}
        </p>
      </div>

      <Ticket
        reference={booking.reference}
        qrDataUrl={qrDataUrl}
        issuedLabel={`${formatDateLong(new Date(booking.confirmedAt ?? booking.startsAt), settings.timezone).toUpperCase()} IST`}
        companionName={booking.companionName}
        durationLabel={`${hours} hour${hours === 1 ? '' : 's'} · no extension`}
        dateLabel={formatDateLong(starts, settings.timezone)}
        timeLabel={`${formatSlotLabel(starts, settings.timezone)} – ${formatSlotLabel(ends, settings.timezone)}`}
        areaLabel={booking.areaName}
        bookedByLabel={firstName(customer.full_name)}
        amountLabel={formatPaise(booking.amountPaise)}
        methodLabel={`${(booking.paymentMethod ?? 'PAID').toUpperCase()} · RAZORPAY`}
        termsLabel={`TERMS ${booking.termsVersion} ACCEPTED`}
        conductSummary={CONDUCT_SUMMARY}
        cancelled={cancelled}
      />

      <div className="relative px-5 pb-6">
        <div className="ac-no-print rounded-lg border border-white/15 bg-white/[.04] px-3.5 py-3">
          <div className="mb-[7px] font-mono text-[9px] font-semibold tracking-[0.13em] text-[#F98CA2]">
            IF SOMETHING GOES WRONG
          </div>
          <p className="mb-2.5 font-sans text-[12.5px] leading-[1.5] text-white/70">
            Call us during service hours and we will step in — including ending the
            booking on your side.
          </p>
          <div className="flex items-center gap-2">
            <a
              href={SUPPORT_PHONE_HREF}
              className="font-mono text-[14px] font-semibold text-white"
            >
              {SUPPORT_PHONE}
            </a>
            <span className="font-mono text-[10px] font-medium text-white/45">
              {SERVICE_HOURS_SHORT}
            </span>
          </div>
        </div>

        <nav className="ac-no-print mt-4 flex flex-wrap gap-3.5">
          {!cancelled && booking.status === 'confirmed' && (
            <Link
              href={`/bookings/${booking.reference}/cancel`}
              className="font-sans text-[12.5px] text-blue-soft"
            >
              Cancel this booking
            </Link>
          )}
          <Link href="/policies/refunds" className="font-sans text-[12.5px] text-blue-soft">
            Refund policy
          </Link>
          <Link href="/policies/conduct" className="font-sans text-[12.5px] text-blue-soft">
            Conduct policy
          </Link>
          <Link href="/bookings" className="font-sans text-[12.5px] text-blue-soft">
            All your bookings
          </Link>
        </nav>
      </div>
    </div>
  )
}

/** Companions see a first name only; the ticket shows her the same (PRD §6.8). */
function firstName(full: string | null): string {
  if (!full) return '—'
  return full.trim().split(/\s+/)[0]
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    confirmed: {
      label: 'PAYMENT CAPTURED',
      className: 'text-[#5FD3A3] bg-[#5FD3A3]/10 border-[#5FD3A3]/30',
    },
    completed: {
      label: 'COMPLETED',
      className: 'text-[#5FD3A3] bg-[#5FD3A3]/10 border-[#5FD3A3]/30',
    },
    ended_early: {
      label: 'ENDED EARLY',
      className: 'text-[#F0C87A] bg-[#F0C87A]/10 border-[#F0C87A]/30',
    },
  }
  const fallback = {
    label: status.replace(/_/g, ' ').toUpperCase(),
    className: 'text-white/70 bg-white/10 border-white/20',
  }
  const pill = map[status] ?? fallback

  return (
    <span
      className={`rounded-full border px-[9px] py-[5px] font-mono text-[9.5px] font-semibold tracking-[0.08em] ${pill.className}`}
    >
      {pill.label}
    </span>
  )
}
