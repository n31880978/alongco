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

type RazorpayOptions = {
  key: string
  order_id: string
  amount: number
  currency: 'INR'
  name: string
  description: string
  prefill: { name?: string; email?: string; contact?: string }
  notes: Record<string, string>
  theme: { color: string }
  retry: { enabled: boolean }
  handler: (response: {
    razorpay_order_id: string
    razorpay_payment_id: string
    razorpay_signature: string
  }) => void
  modal: { ondismiss: () => void }
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void }
  }
}

/**
 * Terms acceptance gate and the pay button. PRD §6.5, §6.6.
 *
 * The terms are shown in full on this screen — not behind a link.
 * The pay button is inert until the box is ticked, and the server action
 * re-checks acceptance and terms version, so devtools cannot bypass it.
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

  useEffect(() => {
    if (state.expired) router.refresh()
  }, [state.expired, router])

  useEffect(() => {
    const order = state.order
    if (!order || !sdkReady || opening || !window.Razorpay) return

    setOpening(true)

    const checkout = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: 'INR',
      name: 'AlongCo',
      description: `Booking ${order.reference}`,
      prefill: {
        name: order.prefillName ?? undefined,
        email: order.prefillEmail ?? undefined,
        contact: order.prefillContact ?? undefined,
      },
      notes: { booking_reference: order.reference },
      theme: { color: '#2E63E8' },
      retry: { enabled: false },
      // This is a UX signal only — never confirms the booking.
      // The webhook does that (CLAUDE.md §3.3).
      handler: (response) => {
        const query = new URLSearchParams({
          b: bookingId,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        })
        router.push(`/book/${slug}/pay/return?${query}`)
      },
      modal: {
        ondismiss: () => setOpening(false),
      },
    })

    checkout.open()
  }, [state.order, sdkReady, opening, router, slug, bookingId])

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setSdkReady(true)}
      />

      {/* Terms of booking */}
      <section className="border-b border-ink/10 bg-white px-[18px] py-5">
        <div className="mb-3 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink/40">
          Terms of this booking
        </div>

        <ul className="mb-4 space-y-2.5">
          {clauses.map((c) => (
            <li
              key={c.text}
              className="flex items-start gap-3 rounded-lg border border-ink/[.07] bg-paper px-3.5 py-2.5"
            >
              <span
                aria-hidden
                className="mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-rose-deep"
              />
              <span
                className={cn(
                  'font-sans text-[12.5px] leading-[1.5] text-ink/75',
                  c.emphasis && 'font-medium text-ink',
                )}
              >
                {c.text}
              </span>
            </li>
          ))}
        </ul>

        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white px-4 py-3.5 transition-colors',
            accepted ? 'border-ink' : 'border-ink/10',
          )}
        >
          <div className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
            accepted ? 'border-ink bg-ink' : 'border-ink/20 bg-white',
          )}>
            {accepted && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden>
                <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="sr-only"
          />
          <span className="font-sans text-[13px] font-medium leading-[1.5] text-ink">
            I have read these terms and I accept them.
          </span>
        </label>
      </section>

      {/* Payment error */}
      {state.error && (
        <section className="border-b border-amber/20 bg-amber-tint px-[18px] py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber/20">
              <span className="font-mono text-[10px] font-bold text-amber">!</span>
            </div>
            <div>
              <p className="font-mono text-[9.5px] font-bold uppercase tracking-[.1em] text-amber">
                Payment couldn't start
              </p>
              <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink/80">
                {state.error}
              </p>
              <a
                href={SUPPORT_PHONE_HREF}
                className="mt-2 inline-flex items-center gap-1.5 font-sans text-[12.5px] font-semibold text-ink"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M2.5 2h2l1 2.5-1.5 1a6.5 6.5 0 0 0 4.5 4.5l1-1.5L12 9.5v2a1 1 0 0 1-1 1C5.5 12.5 1.5 8.5 1.5 3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Call us: {SUPPORT_PHONE}
              </a>
            </div>
          </div>
        </section>
      )}

      {/* Pay button section */}
      <section className="bg-white px-[18px] pb-6 pt-4">
        <form action={submit}>
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="termsVersion" value={termsVersion} />
          {accepted && <input type="hidden" name="accepted" value="on" />}
          <PayButton amountLabel={amountLabel} disabled={!accepted} opening={opening} />
        </form>

        <p className="mt-3 text-center font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink/35">
          Razorpay · UPI · Card · Net banking
        </p>

        <div className="mt-4 rounded-xl border border-ink/[.07] bg-paper px-4 py-3.5">
          <p className="font-sans text-[12px] leading-[1.55] text-ink/55">
            Your booking is confirmed by our payment provider, not by this page. If your
            connection drops after paying, the ticket still appears automatically. Need
            help?{' '}
            <a href={SUPPORT_PHONE_HREF} className="font-mono text-[11.5px] font-semibold text-ink">
              {SUPPORT_PHONE}
            </a>
          </p>
        </div>

        <p className="mt-3 text-center font-mono text-[9px] text-ink/25">REF {reference}</p>
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
      sheen={!disabled && !busy}
      disabled={disabled || busy}
      className="h-[54px] w-full text-[15px]"
    >
      {busy ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="6" stroke="white" strokeOpacity=".3" strokeWidth="2" />
            <path d="M14 8a6 6 0 0 0-6-6" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Opening secure checkout…
        </span>
      ) : (
        `Pay ${amountLabel} and confirm`
      )}
    </Button>
  )
}
