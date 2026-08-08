import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SignIn } from '@clerk/nextjs'
import { PublicHeader } from '@/components/site/header'
import { getAuthSubject } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

/**
 * Customer sign-in, by Clerk.
 *
 * The catch-all segment is required: Clerk routes its own sub-steps
 * (verification, factor selection, SSO callback) under this path, and without
 * it every one of those is a 404 mid-sign-in.
 *
 * Clerk's component is styled to the design tokens rather than left default —
 * this is the screen where a woman decides whether the site is trustworthy
 * enough to give her money to, and a stock widget in another product's colours
 * is exactly the wrong signal there.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  if (await getAuthSubject()) {
    redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/bookings')
  }

  const redirectUrl =
    next && next.startsWith('/') && !next.startsWith('//') ? next : '/bookings'

  return (
    <>
      <PublicHeader back={{ href: '/companions', label: 'Sign in' }} />

      <section className="mx-auto w-full max-w-[560px] border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px] md:pt-8">
        <h1 className="mb-1.5 font-serif text-[24px] font-light leading-[1.2] text-ink md:text-[28px]">
          Sign in to book
        </h1>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
          Sign in with your email or Google account. Your phone number for WhatsApp
          confirmation is collected at the booking step.
        </p>
      </section>

      <div className="mx-auto flex w-full max-w-[560px] justify-center bg-white px-[18px] py-6">
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          forceRedirectUrl={redirectUrl}
          appearance={{
            // Styled through `elements` with the project's own Tailwind tokens
            // rather than Clerk's `variables`. The variable names have changed
            // between Clerk majors; class names here are ours and will not.
            elements: {
              rootBox: 'w-full',
              cardBox: 'w-full shadow-none border-0',
              card: 'shadow-none border-0 p-0 bg-white',
              header: 'hidden',
              footer: 'bg-transparent',
              formButtonPrimary:
                'h-[52px] rounded-lg bg-ink text-white font-sans text-[15px] font-semibold normal-case hover:bg-ink-deep shadow-none',
              formFieldLabel: 'font-sans text-[11px] font-semibold text-ink',
              formFieldInput:
                'h-12 rounded-lg border border-ink/15 bg-white px-[13px] font-sans text-[14.5px] text-ink focus:border-blue',
              socialButtonsBlockButton:
                'h-12 rounded-lg border border-ink/15 bg-white font-sans text-[14px] text-ink hover:bg-paper-warm',
              dividerLine: 'bg-ink/10',
              dividerText: 'font-sans text-[11.5px] text-ink/45',
              footerActionText: 'font-sans text-[12.5px] text-ink/55',
              footerActionLink: 'font-sans text-[12.5px] font-semibold text-blue',
              identityPreviewText: 'font-sans text-[13px] text-ink',
              formResendCodeLink: 'font-sans text-[12.5px] font-semibold text-blue',
              otpCodeFieldInput: 'border-ink/15 text-ink',
            },
          }}
        />
      </div>

      <p className="mx-auto w-full max-w-[560px] bg-white px-[18px] pb-6 font-sans text-[11.5px] leading-[1.5] text-ink/50">
        This is not the staff sign-in. If you work here, use the operations
        subdomain.
      </p>
    </>
  )
}
