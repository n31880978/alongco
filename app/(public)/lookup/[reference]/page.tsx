import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getBookingByReferencePublic } from '@/lib/booking/queries'
import { Button } from '@/components/ui/button'

export const revalidate = 300

type Props = {
  params: Promise<{ reference: string }>
}

export default async function LookupPage({ params }: Props) {
  const { reference } = await params
  const booking = await getBookingByReferencePublic(reference)

  if (!booking) {
    notFound()
  }

  const startsAt = new Date(booking.startsAt)
  const endsAt = new Date(booking.endsAt)
  const now = new Date()

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    pending_payment: {
      bg: 'bg-yellow-tint',
      text: 'text-yellow-dark',
      label: 'Payment Pending',
    },
    confirmed: {
      bg: 'bg-blue-tint',
      text: 'text-blue',
      label: 'Confirmed',
    },
    completed: {
      bg: 'bg-green-tint',
      text: 'text-green',
      label: 'Completed',
    },
    cancelled_by_customer: {
      bg: 'bg-slate-tint',
      text: 'text-slate',
      label: 'Cancelled',
    },
    cancelled_by_admin: {
      bg: 'bg-slate-tint',
      text: 'text-slate',
      label: 'Cancelled',
    },
    ended_early: {
      bg: 'bg-slate-tint',
      text: 'text-slate',
      label: 'Ended Early',
    },
    no_show_customer: {
      bg: 'bg-slate-tint',
      text: 'text-slate',
      label: 'No Show',
    },
    no_show_companion: {
      bg: 'bg-slate-tint',
      text: 'text-slate',
      label: 'No Show',
    },
    expired: {
      bg: 'bg-slate-tint',
      text: 'text-slate',
      label: 'Expired',
    },
  }

  const status = statusColors[booking.status] || statusColors.pending_payment
  const isUpcoming = startsAt > now

  return (
    <div className="mx-auto max-w-[600px] space-y-6 px-5 py-8">
      {/* Header */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-serif text-[32px] font-light text-ink">Your booking</h1>
          <Link href="/">
            <Button variant="ghost" size="sm">
              ← Back
            </Button>
          </Link>
        </div>
        <p className="font-mono text-[12px] tracking-[0.1em] text-ink/50">
          {booking.reference}
        </p>
      </div>

      {/* Status badge */}
      <div className={`rounded-md ${status.bg} px-3 py-2`}>
        <span className={`font-sans text-[13px] font-semibold ${status.text}`}>
          {status.label}
        </span>
      </div>

      {/* Companion and area */}
      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="flex gap-4">
          {booking.companionPhotoPath && (
            <img
              src={`/api/image/${booking.companionPhotoPath}?w=80&h=80`}
              alt={booking.companionName}
              className="h-20 w-20 rounded-lg object-cover"
            />
          )}
          <div className="flex-1">
            <h2 className="font-sans text-[16px] font-semibold text-ink">
              {booking.companionName}
            </h2>
            <p className="mt-1 font-sans text-[13px] text-ink/60">
              Meeting at: <span className="font-semibold text-ink">{booking.areaName}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Time and date */}
      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="mb-3 font-mono text-[11px] font-semibold tracking-[0.1em] text-ink/45">
          DATE & TIME
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="font-sans text-[14px] text-ink/60">Starts</span>
            <span className="font-sans text-[14px] font-semibold text-ink">
              {startsAt.toLocaleDateString('en-IN', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-sans text-[14px] text-ink/60">Ends</span>
            <span className="font-sans text-[14px] font-semibold text-ink">
              {endsAt.toLocaleDateString('en-IN', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="flex justify-between pt-2 font-sans text-[13px]">
            <span className="text-ink/60">Duration</span>
            <span className="font-semibold text-ink">
              {Math.round((endsAt.getTime() - startsAt.getTime()) / (1000 * 60))} minutes
            </span>
          </div>
        </div>
      </div>

      {/* Status message */}
      {booking.status === 'pending_payment' && isUpcoming && (
        <div className="rounded-md border-l-4 border-yellow-dark bg-yellow-tint/50 p-4">
          <p className="font-sans text-[13px] leading-[1.5] text-ink">
            Your payment is being processed. We'll send a confirmation message on WhatsApp
            shortly. If you don't receive it within 15 minutes,{' '}
            <Link href="/" className="font-semibold underline">
              try booking again
            </Link>{' '}
            or contact us.
          </p>
        </div>
      )}

      {booking.status === 'confirmed' && isUpcoming && (
        <div className="rounded-md border-l-4 border-blue bg-blue-tint/50 p-4">
          <p className="font-sans text-[13px] leading-[1.5] text-ink">
            Your booking is confirmed. We'll see you at the meeting time. If you need to
            cancel,{' '}
            <Link href="/" className="font-semibold underline">
              sign in to manage your booking
            </Link>
            .
          </p>
        </div>
      )}

      {booking.status === 'completed' && (
        <div className="rounded-md border-l-4 border-green bg-green-tint/50 p-4">
          <p className="font-sans text-[13px] leading-[1.5] text-ink">
            Booking completed. Thank you for using AlongCo. If you'd like to leave a review,
            you can sign in to do so.
          </p>
        </div>
      )}

      {!isUpcoming && booking.status !== 'completed' && (
        <div className="rounded-md border-l-4 border-slate bg-slate-tint/50 p-4">
          <p className="font-sans text-[13px] leading-[1.5] text-ink">
            This booking is no longer upcoming.{' '}
            <Link href="/" className="font-semibold underline">
              Book a new slot
            </Link>
            .
          </p>
        </div>
      )}

      {/* Footer CTA */}
      <div className="flex flex-col gap-2">
        <Button asChild size="lg" className="w-full">
          <Link href="/companions">Browse companions</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
