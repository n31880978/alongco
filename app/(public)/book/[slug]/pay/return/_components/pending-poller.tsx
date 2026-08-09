'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'

/**
 * Waits for the webhook.
 *
 * Refreshes the server component rather than deciding anything — the page
 * re-reads the booking, and redirects to the ticket only once the database
 * says `confirmed`. Nothing here can confirm a booking (CLAUDE.md §3.3).
 */
export function PendingPoller({
  reference,
  stillHeld,
  checkoutCompleted,
  retryHref,
}: {
  reference: string
  stillHeld: boolean
  checkoutCompleted: boolean
  retryHref: string
}) {
  const router = useRouter()
  const [waitedSeconds, setWaited] = useState(0)

  useEffect(() => {
    if (!checkoutCompleted) return
    const tick = setInterval(() => setWaited((s) => s + 2), 2000)
    const poll = setInterval(() => router.refresh(), waitedSeconds < 30 ? 2000 : 6000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [router, waitedSeconds, checkoutCompleted])

  const slow = waitedSeconds >= 20

  return (
    <div className="bg-white">
      {/* Status indicator */}
      <div className={`px-[18px] py-3.5 border-b ${checkoutCompleted ? 'bg-blue-tint border-blue/15' : 'bg-amber-tint border-amber/20'}`}>
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className={`absolute inset-0 rounded-full ${checkoutCompleted ? 'bg-blue' : 'bg-amber'}`} />
            {checkoutCompleted && (
              <span className="absolute inset-0 animate-pulse2 rounded-full bg-blue" />
            )}
          </span>
          <span className={`font-mono text-[10px] font-semibold tracking-[0.1em] ${checkoutCompleted ? 'text-blue-dark' : 'text-amber'}`}>
            {checkoutCompleted ? 'PAYMENT VERIFIED · CONFIRMING BOOKING' : 'PAYMENT NOT COMPLETED'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <section className="px-[18px] py-6">
        <h1 className="mb-2 font-serif text-[24px] font-light leading-[1.2] text-ink">
          {checkoutCompleted
            ? 'Your payment is verified'
            : 'Nothing was charged'}
        </h1>
        <p className="mb-5 font-sans text-[13px] leading-[1.6] text-ink/65">
          {checkoutCompleted
            ? 'We received Razorpay\'s signed confirmation and are waiting for the final server-to-server acknowledgement. This usually takes a few seconds. Do not pay again.'
            : 'We did not receive a verified payment for this booking. Nothing has been charged. You can safely try again while your slot is held.'}
        </p>

        {/* Reference */}
        <div className="mb-5 rounded-xl border border-ink/10 bg-paper px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/45">
              Booking reference
            </span>
            <span className="font-mono text-[14px] font-bold text-ink">{reference}</span>
          </div>
        </div>

        {/* Slow warning */}
        {checkoutCompleted && slow && (
          <div className="mb-5 rounded-xl border border-amber/25 bg-amber-tint px-4 py-3.5">
            <p className="mb-1 font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-amber">
              Taking longer than usual
            </p>
            <p className="font-sans text-[12.5px] leading-[1.55] text-ink/75">
              {stillHeld
                ? 'Your slot is still held. If money left your account, it will appear here shortly — do not pay a second time.'
                : 'If money left your account it will be returned automatically. Do not pay a second time.'}{' '}
              Call us on{' '}
              <a href={SUPPORT_PHONE_HREF} className="font-mono font-semibold text-ink underline-offset-2 underline">
                {SUPPORT_PHONE}
              </a>{' '}
              with the reference above.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2.5">
          {checkoutCompleted && (
            <Link
              href={`/ticket/${reference}`}
              className="flex h-[50px] items-center justify-center rounded-xl border border-ink/15 font-sans text-[13.5px] font-semibold text-ink hover:bg-paper-warm transition-colors"
            >
              Check my ticket
            </Link>
          )}
          {stillHeld && !checkoutCompleted && (
            <Link
              href={retryHref}
              className="flex h-[50px] items-center justify-center rounded-xl bg-ink font-sans text-[13.5px] font-semibold text-white transition-colors"
            >
              Try paying again
            </Link>
          )}
          {stillHeld && checkoutCompleted && (
            <Link
              href={retryHref}
              className="flex h-[50px] items-center justify-center rounded-xl border border-blue/25 bg-blue-tint font-sans text-[13.5px] font-semibold text-blue-dark transition-colors"
            >
              Retry payment
            </Link>
          )}
        </div>

        {/* Support footer */}
        <p className="mt-5 text-center font-sans text-[12px] text-ink/45">
          Need help?{' '}
          <a href={SUPPORT_PHONE_HREF} className="font-mono font-semibold text-ink">
            {SUPPORT_PHONE}
          </a>
        </p>
      </section>
    </div>
  )
}
