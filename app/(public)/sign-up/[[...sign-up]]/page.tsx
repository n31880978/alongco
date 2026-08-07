import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SignUp } from '@clerk/nextjs'
import { PublicHeader } from '@/components/site/header'
import { getAuthSubject } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

/** Sign-up, by Clerk. Catch-all for the same reason as sign-in. */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  if (await getAuthSubject()) redirect('/bookings')

  const redirectUrl =
    next && next.startsWith('/') && !next.startsWith('//') ? next : '/bookings'

  return (
    <>
      <PublicHeader back={{ href: '/companions', label: 'Create account' }} />

      <section className="mx-auto w-full max-w-[560px] border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px] md:pt-8">
        <h1 className="mb-1.5 font-serif text-[24px] font-light leading-[1.2] text-ink md:text-[28px]">
          Create your account
        </h1>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
          We ask for the minimum a booking needs. Your phone number comes at the
          next step, so we can confirm on WhatsApp.
        </p>
      </section>

      <div className="mx-auto flex w-full max-w-[560px] justify-center bg-white px-[18px] py-6">
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
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
    </>
  )
}
