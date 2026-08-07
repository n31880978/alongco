import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { getCurrentCustomer } from '@/lib/auth/session'
import { SignInForm } from './_components/sign-in-form'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false },
}

/**
 * Why a link that failed gets a specific message rather than a generic one:
 * every reason below has a different action attached, and "something went
 * wrong" on the sign-in step of a booking is the point where she gives up.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  wrong_browser:
    'That link opened in a different browser to the one you started in, so we could not sign you in. Send a new one below and open it here — or long-press the link in your email and choose “open in browser”.',
  expired:
    'That link has expired or was already used. Sign-in links are good for one use — send yourself a fresh one.',
  missing: 'That link was incomplete. Send yourself a fresh one below.',
  account:
    'We confirmed your email but could not open your account. Please try once more, or call us and we will book it by hand.',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams
  const customer = await getCurrentCustomer()
  if (customer) redirect(next && next.startsWith('/') ? next : '/bookings')

  const callbackError = error ? CALLBACK_ERRORS[error] : undefined

  return (
    <>
      <PublicHeader back={{ href: '/companions', label: 'Sign in' }} />
      <section className="mx-auto w-full max-w-[560px] border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px] md:pt-8">
        <h1 className="mb-1.5 font-serif text-[24px] font-light leading-[1.2] text-ink md:text-[28px]">
          Your email, and a link to confirm it
        </h1>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
          We email you a link to confirm the address is yours. Your phone number comes at
          the next step — that is how your booking confirmation reaches you on WhatsApp,
          and how we reach you if something changes.
        </p>
      </section>

      {callbackError && (
        <div className="mx-auto w-full max-w-[560px] bg-white px-[18px] pt-4">
          <p
            role="alert"
            className="rounded-lg border border-amber/30 bg-amber-tint px-3.5 py-3 font-sans text-[12.5px] leading-[1.55] text-ink/80"
          >
            {callbackError}
          </p>
        </div>
      )}

      <SignInForm next={next} />
    </>
  )
}
