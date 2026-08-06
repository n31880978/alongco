'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'

/**
 * Waits for the webhook.
 *
 * It refreshes the server component rather than deciding anything: the page
 * re-reads the booking, and redirects to the ticket only once the database says
 * `confirmed`. Nothing here can confirm a booking (CLAUDE.md §3.3).
 */
export function PendingPoller({
  reference,
  stillHeld,
  retryHref,
}: {
  reference: string
  stillHeld: boolean
  retryHref: string
}) {
  const router = useRouter()
  const [waitedSeconds, setWaited] = useState(0)

  useEffect(() => {
    const tick = setInterval(() => setWaited((s) => s + 2), 2000)
    // Back off after the first half-minute; a webhook this late is unusual and
    // hammering the database will not make it arrive sooner.
    const poll = setInterval(() => router.refresh(), waitedSeconds < 30 ? 2000 : 6000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [router, waitedSeconds])

  const slow = waitedSeconds >= 20

  return (
    <section className="bg-white px-[18px] py-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-blue" />
          <span className="absolute inset-0 animate-pulse2 rounded-full bg-blue" />
        </span>
        <span className="font-mono text-[10px] font-semibold tracking-[0.1em] text-blue-dark">
          CHECKING WITH THE PAYMENT PROVIDER
        </span>
      </div>

      <h1 className="mb-2 font-serif text-[22px] font-light leading-[1.22] text-ink">
        Hold on — we are confirming your payment
      </h1>
      <p className="mb-4 font-sans text-[13px] leading-[1.5] text-ink/65">
        Your bank tells us directly, which is more reliable than this page. It usually
        takes a few seconds. You do not need to pay again, and you can close this page —
        the ticket will be in your bookings either way.
      </p>

      <dl className="mb-4 rounded-lg border border-ink/10 bg-paper px-3.5 py-3">
        <div className="flex justify-between">
          <dt className="font-sans text-[12.5px] text-ink/60">Reference</dt>
          <dd className="font-mono text-[12.5px] font-semibold text-ink">{reference}</dd>
        </div>
      </dl>

      {slow && (
        <div className="mb-4 rounded-lg border border-amber/25 bg-amber-tint px-3.5 py-3">
          <p className="font-sans text-[12.5px] leading-[1.5] text-ink/75">
            This is taking longer than usual.{' '}
            {stillHeld
              ? 'Your slot is still held. If the money left your account it will show here shortly — do not pay a second time.'
              : 'If money left your account it will be returned automatically. Do not pay a second time.'}{' '}
            Call us on{' '}
            <a href={SUPPORT_PHONE_HREF} className="font-mono font-medium text-ink">
              {SUPPORT_PHONE}
            </a>{' '}
            with the reference above and we will check it while you wait.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Link
          href="/bookings"
          className="flex h-[46px] flex-1 items-center justify-center rounded-lg border border-ink/15 font-sans text-[13.5px] font-semibold text-ink"
        >
          Your bookings
        </Link>
        {stillHeld && (
          <Link
            href={retryHref}
            className="flex h-[46px] flex-1 items-center justify-center rounded-lg border border-blue/30 font-sans text-[13.5px] font-semibold text-blue-dark"
          >
            Try paying again
          </Link>
        )}
      </div>
    </section>
  )
}
