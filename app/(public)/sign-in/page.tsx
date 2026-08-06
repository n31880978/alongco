import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { getCurrentCustomer } from '@/lib/auth/session'
import { SignInForm } from './_components/sign-in-form'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false },
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const customer = await getCurrentCustomer()
  if (customer) redirect(next && next.startsWith('/') ? next : '/bookings')

  return (
    <>
      <PublicHeader back={{ href: '/companions', label: 'Sign in' }} />
      <section className="mx-auto w-full max-w-[560px] border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px] md:pt-8">
        <h1 className="mb-1.5 font-serif text-[24px] font-light leading-[1.2] text-ink md:text-[28px]">
          Your email, and a six-digit code
        </h1>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
          We send the code to your inbox. Your phone number comes at the next step —
          that is how your confirmation reaches you on WhatsApp, and how we reach you if
          something changes.
        </p>
      </section>
      <SignInForm next={next} />
    </>
  )
}
