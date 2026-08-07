'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'

/**
 * The customer-facing error boundary.
 *
 * CLAUDE.md §6 is explicit that she must never be told "something went wrong"
 * on the payment or slot path, because the thing she urgently needs to know is
 * whether her money moved. This boundary cannot know which page threw, so it
 * answers that question the only way it honestly can: nothing is charged
 * without the confirmation screen and a ticket, and if she has neither, no
 * payment completed. That is true regardless of where the error came from.
 *
 * `digest` is Next's hash of the server-side error. It is safe to show — it
 * carries no stack and no payload — and it is the one thing that makes a
 * support call actionable.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Client-side console only. The server error is already reported through
    // lib/observability; repeating the message here would risk putting payload
    // detail into a browser log (§9).
    console.error('Page error', error.digest ?? '')
  }, [error])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center bg-paper px-[18px] py-12">
      <p className="mb-2 font-mono text-[10px] font-semibold tracking-[0.13em] text-rose-deep">
        SOMETHING BROKE ON OUR SIDE
      </p>
      <h1 className="mb-3 font-serif text-[28px] font-light leading-[1.15] text-ink">
        This page did not load
      </h1>

      <div className="mb-5 rounded-lg border border-green/25 bg-green-tint px-3.5 py-3">
        <p className="font-sans text-[13px] leading-[1.55] text-ink/80">
          <strong className="font-semibold text-ink">
            You have not been charged for anything you did not see confirmed.
          </strong>{' '}
          A booking is only paid once you have reached the ticket screen. If you have no
          ticket, no payment completed.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <Button onClick={reset} size="lg" className="w-full">
          Try again
        </Button>
        <Button asChild variant="outline" size="md" className="w-full">
          <Link href="/bookings">Check your bookings</Link>
        </Button>
      </div>

      <p className="mt-6 border-t border-ink/10 pt-4 font-sans text-[12.5px] leading-[1.5] text-ink/55">
        Still stuck? Call{' '}
        <a href={SUPPORT_PHONE_HREF} className="font-mono font-medium text-ink">
          {SUPPORT_PHONE}
        </a>{' '}
        and we will book it by hand.
        {error.digest && (
          <>
            {' '}
            Quote reference{' '}
            <span className="font-mono font-medium text-ink">{error.digest}</span>.
          </>
        )}
      </p>
    </main>
  )
}
