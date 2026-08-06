'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import Script from 'next/script'
import { Button } from '@/components/ui/button'
import type { TermsClause } from '@/lib/booking/terms'
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'
import { startPayment, type PayState } from '../actions'
import { cn } from '@/lib/utils'

declare global {
  interface Window {
    Cashfree?: (config: { mode: 'sandbox' | 'production' }) => {
      checkout: (opts: {
        paymentSessionId: string
        redirectTarget?: '_self' | '_blank' | '_modal'
      }) => Promise<unknown>
    }
  }
}

/**
 * The terms gate and the pay button. PRD §6.5, §6.6.
 *
 * The terms are rendered in full here, not behind a link, and the pay button is
 * genuinely inert until the box is ticked — the server action re-checks the
 * acceptance and the version, so unchecking it in devtools buys nothing.
 */
export function Checkout({
  bookingId,
  slug,
  reference,
  termsVersion,
  clauses,
  amountLabel,
}: {
  bookingId: string
  slug: string
  reference: string
  termsVersion: string
  clauses: TermsClause[]
  amountLabel: string
}) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [sdkReady, setSdkReady] = useState(false)
  const [opening, setOpening] = useState(false)
  const [state, submit] = useActionState<PayState, FormData>(startPayment, {})

  const mode = process.env.NEXT_PUBLIC_CASHFREE_ENV === 'production' ? 'production' : 'sandbox'

  // The hold lapsed while she was on this screen — show her the real state.
  useEffect(() => {
    if (state.expired) router.refresh()
  }, [state.expired, router])

  // Hand the session to Cashfree once the server has created the order.
  useEffect(() => {
    if (!state.paymentSessionId || !sdkReady || opening) return
    const cashfree = window.Cashfree?.({ mode })
    if (!cashfree) return

    setOpening(true)
    void cashfree
      .checkout({ paymentSessionId: state.paymentSessionId, redirectTarget: '_self' })
      .catch(() => setOpening(false))
  }, [state.paymentSessionId, sdkReady, opening, mode])

  return (
    <>
      <Script
        src="https://sdk.cashfree.com/js/v3/cashfree.js"
        strategy="afterInteractive"
        onLoad={() => setSdkReady(true)}
      />

      {/* The terms, in full, on the screen itself */}
      <section className="border-b border-rose/20 bg-rose-tint px-[18px] py-4">
        <h2 className="mb-[11px] font-mono text-[9px] font-semibold tracking-[0.12em] text-rose-deep">
          THE TERMS OF THIS BOOKING
        </h2>
        <ul className="mb-3 flex flex-col gap-[9px]">
          {clauses.map((c) => (
            <li
              key={c.text}
              className="flex gap-[9px] font-sans text-[12.5px] leading-[1.45] text-ink/80"
            >
              <span
                aria-hidden
                className="mt-1.5 h-[5px] w-[5px] shrink-0 bg-[#E8557A]"
              />
              <span className={cn(c.emphasis && 'font-medium text-ink')}>{c.text}</span>
            </li>
          ))}
        </ul>

        <label
          className={cn(
            'flex cursor-pointer gap-2.5 rounded-lg border bg-white px-[13px] py-3 transition-colors',
            accepted ? 'border-ink' : 'border-rose/30',
          )}
        >
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#16161A]"
          />
          <span className="font-sans text-[12.5px] font-medium leading-[1.45] text-ink">
            I have read these terms and I accept them.
          </span>
        </label>
      </section>

      {/* Pay */}
      <section className="bg-white px-[18px] pb-[18px] pt-4">
        {state.error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-rose/25 bg-rose-tint px-3 py-2.5 font-sans text-[12.5px] leading-[1.45] text-ink/80"
          >
            {state.error}
          </p>
        )}

        <form action={submit}>
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="termsVersion" value={termsVersion} />
          {/* Only present when the box is ticked, so the action can require it. */}
          {accepted && <input type="hidden" name="accepted" value="on" />}
          <PayButton amountLabel={amountLabel} disabled={!accepted} opening={opening} />
        </form>

        <p className="mb-3.5 mt-2.5 text-center font-mono text-[10px] font-medium text-ink/45">
          CASHFREE · UPI, CARD, NETBANKING
        </p>

        <p className="border-t border-ink/10 pt-3 font-sans text-[11.5px] leading-[1.5] text-ink/55">
          Your booking is confirmed by our payment provider, not by this page. If your
          connection drops after paying, the ticket still appears in your bookings.
          Trouble?{' '}
          <a href={SUPPORT_PHONE_HREF} className="font-mono font-medium text-ink">
            {SUPPORT_PHONE}
          </a>
        </p>
        <p className="mt-2 font-mono text-[9.5px] text-ink/35">REF {reference}</p>
      </section>
    </>
  )
}

function PayButton({
  amountLabel,
  disabled,
  opening,
}: {
  amountLabel: string
  disabled: boolean
  opening: boolean
}) {
  const { pending } = useFormStatus()
  const busy = pending || opening
  return (
    <Button
      type="submit"
      size="lg"
      sheen={!disabled}
      disabled={disabled || busy}
      className="h-[54px] w-full"
    >
      {busy ? 'Opening secure checkout…' : `Pay ${amountLabel} and book`}
    </Button>
  )
}
