import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getBookingByReferencePublic } from '@/lib/booking/queries'
import { Button } from '@/components/ui/button'

export const revalidate = 300

type Props = {
  searchParams: Promise<{ reference?: string }>
}

async function CheckBookingContent({ reference }: { reference: string }) {
  const booking = await getBookingByReferencePublic(reference)

  if (!booking) {
    notFound()
  }

  const startsAt = new Date(booking.startsAt)
  const endsAt = new Date(booking.endsAt)
  const now = new Date()

  const statusColors: Record<
    string,
    { bg: string; text: string; label: string; borderColor: string }
  > = {
    pending_payment: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      label: 'Payment Pending',
      borderColor: 'border-amber-200',
    },
    confirmed: {
      bg: 'bg-blue-tint',
      text: 'text-blue',
      label: 'Confirmed',
      borderColor: 'border-blue/20',
    },
    completed: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      label: 'Completed',
      borderColor: 'border-green-200',
    },
    cancelled_by_customer: {
      bg: 'bg-slate-50',
      text: 'text-slate-600',
      label: 'Cancelled',
      borderColor: 'border-slate-200',
    },
    cancelled_by_admin: {
      bg: 'bg-slate-50',
      text: 'text-slate-600',
      label: 'Cancelled',
      borderColor: 'border-slate-200',
    },
    ended_early: {
      bg: 'bg-slate-50',
      text: 'text-slate-600',
      label: 'Ended Early',
      borderColor: 'border-slate-200',
    },
    no_show_customer: {
      bg: 'bg-slate-50',
      text: 'text-slate-600',
      label: 'No Show',
      borderColor: 'border-slate-200',
    },
    no_show_companion: {
      bg: 'bg-slate-50',
      text: 'text-slate-600',
      label: 'No Show',
      borderColor: 'border-slate-200',
    },
    expired: {
      bg: 'bg-slate-50',
      text: 'text-slate-600',
      label: 'Expired',
      borderColor: 'border-slate-200',
    },
  }

  const status = statusColors[booking.status] || statusColors.pending_payment
  const isUpcoming = startsAt > now
  const durationMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / (1000 * 60))

  return (
    <div className="min-h-screen bg-paper">
      {/* Header with back button */}
      <div className="border-b border-ink/10 bg-white">
        <div className="mx-auto max-w-[600px] px-5 py-4 flex items-center justify-between">
          <h1 className="font-serif text-[24px] font-light text-ink">Your booking</h1>
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-ink/60 hover:text-ink">
              ← Back
            </Button>
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[600px] space-y-6 px-5 py-8">
        {/* Reference and status row */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.1em] text-ink/50 mb-1">
              BOOKING REFERENCE
            </p>
            <p className="font-mono text-[18px] font-semibold text-ink">{booking.reference}</p>
          </div>
          <div
            className={`rounded-full border ${status.borderColor} ${status.bg} px-4 py-2 text-center`}
          >
            <span className={`font-sans text-[12px] font-semibold ${status.text}`}>
              {status.label}
            </span>
          </div>
        </div>

        {/* Companion card */}
        <div className="rounded-lg border border-ink/10 bg-white p-5">
          <p className="font-mono text-[10px] font-semibold tracking-[0.1em] text-ink/45 mb-4">
            COMPANION
          </p>
          <div className="flex gap-4">
            {booking.companionPhotoPath && (
              <img
                src={`/api/image/${booking.companionPhotoPath}?w=100&h=100`}
                alt={booking.companionName}
                className="h-24 w-24 rounded-lg object-cover flex-shrink-0"
              />
            )}
            <div className="flex-1">
              <h2 className="font-sans text-[18px] font-semibold text-ink mb-3">
                {booking.companionName}
              </h2>
              <div className="space-y-2">
                <div>
                  <p className="font-sans text-[12px] text-ink/50 mb-1">Meeting location</p>
                  <p className="font-sans text-[14px] font-medium text-ink">{booking.areaName}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Date and time card */}
        <div className="rounded-lg border border-ink/10 bg-white p-5">
          <p className="font-mono text-[10px] font-semibold tracking-[0.1em] text-ink/45 mb-4">
            DATE & TIME
          </p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="font-sans text-[12px] text-ink/50 mb-2">Starts at</p>
              <p className="font-sans text-[14px] font-semibold text-ink">
                {startsAt.toLocaleDateString('en-IN', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              <p className="font-mono text-[13px] font-semibold text-ink/70">
                {startsAt.toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            </div>
            <div>
              <p className="font-sans text-[12px] text-ink/50 mb-2">Ends at</p>
              <p className="font-sans text-[14px] font-semibold text-ink">
                {endsAt.toLocaleDateString('en-IN', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              <p className="font-mono text-[13px] font-semibold text-ink/70">
                {endsAt.toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            </div>
          </div>
          <div className="border-t border-ink/10 pt-4">
            <p className="font-sans text-[12px] text-ink/50 mb-1">Duration</p>
            <p className="font-sans text-[16px] font-semibold text-ink">{durationMinutes} minutes</p>
          </div>
        </div>

        {/* Status messages */}
        {booking.status === 'pending_payment' && isUpcoming && (
          <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4">
            <p className="font-sans text-[13px] leading-[1.6] text-amber-900">
              <span className="font-semibold">Payment processing.</span> We'll send a confirmation
              message on WhatsApp shortly. If you don't receive it within 15 minutes,{' '}
              <Link href="/" className="font-semibold underline">
                try booking again
              </Link>{' '}
              or contact us.
            </p>
          </div>
        )}

        {booking.status === 'confirmed' && isUpcoming && (
          <div className="rounded-lg border-l-4 border-blue bg-blue-tint p-4">
            <p className="font-sans text-[13px] leading-[1.6] text-blue-dark">
              <span className="font-semibold">Booking confirmed.</span> We'll see you at the
              meeting time. If you need to cancel,{' '}
              <Link href="/" className="font-semibold underline">
                sign in to manage your booking
              </Link>
              .
            </p>
          </div>
        )}

        {booking.status === 'completed' && (
          <div className="rounded-lg border-l-4 border-green-500 bg-green-50 p-4">
            <p className="font-sans text-[13px] leading-[1.6] text-green-900">
              <span className="font-semibold">Booking completed.</span> Thank you for using
              AlongCo. If you'd like to leave a review,{' '}
              <Link href="/" className="font-semibold underline">
                sign in to do so
              </Link>
              .
            </p>
          </div>
        )}

        {!isUpcoming && booking.status !== 'completed' && (
          <div className="rounded-lg border-l-4 border-slate-300 bg-slate-50 p-4">
            <p className="font-sans text-[13px] leading-[1.6] text-slate-700">
              <span className="font-semibold">Booking ended.</span>{' '}
              <Link href="/companions" className="font-semibold underline">
                Book another slot
              </Link>
              .
            </p>
          </div>
        )}

        {/* Footer CTAs */}
        <div className="flex flex-col gap-3 pt-4">
          <Button asChild size="lg" className="w-full">
            <Link href="/companions">Browse companions</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default async function CheckBookingPage({ searchParams }: Props) {
  const { reference } = await searchParams

  if (!reference) {
    redirect('/')
  }

  return (
    <Suspense fallback={<div className="mx-auto max-w-[600px] px-5 py-8">Loading...</div>}>
      <CheckBookingContent reference={reference} />
    </Suspense>
  )
}
