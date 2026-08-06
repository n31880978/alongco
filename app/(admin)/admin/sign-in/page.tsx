import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { AdminSignInForm } from './_components/sign-in-form'

export const metadata = {
  title: 'Sign in · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * The one admin route that does not require an admin.
 *
 * It says as little as possible: no mention of who the operators are, no
 * password reset link that would confirm an address exists, and no hint that a
 * customer account could ever be used here.
 */
export default async function AdminSignInPage() {
  // Already signed in as an admin — nothing to do here.
  const admin = await getCurrentAdmin()
  if (admin) redirect('/admin')

  return (
    <div className="mx-auto max-w-sm py-6 md:py-12">
      <div className="rounded-xl border border-ink/10 bg-paper p-5 md:p-6">
        <p className="mb-1.5 font-mono text-[10px] font-semibold tracking-[0.13em] text-blue-dark">
          ALONGCO OPERATIONS
        </p>
        <h1 className="mb-1 font-serif text-[28px] font-light leading-[1.1] tracking-[-0.02em] text-ink">
          Sign in
        </h1>
        <p className="mb-5 text-[13px] leading-[1.5] text-ink/60">
          Staff access only. Every action inside is recorded against your name.
        </p>

        <AdminSignInForm />
      </div>

      <p className="mt-4 px-1 text-[12px] leading-[1.5] text-ink/45">
        This is not the customer sign-in. If you are here to manage a booking you
        made, use the main site.
      </p>
    </div>
  )
}
