import Link from 'next/link'
import { GradientRule, Mark } from '@/components/brand/mark'
import { Analytics } from '@/components/analytics/ga'
import {
  SERVICE_HOURS_LABEL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
} from '@/lib/contact'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col bg-paper shadow-none md:max-w-[720px]">
      <GradientRule />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      {/* Public pages only — the admin surface is never measured. */}
      <Analytics />
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="ac-no-print relative overflow-hidden bg-ink px-5 pb-7 pt-7">
      <GradientRule className="absolute inset-x-0 top-0" />
      <Mark className="pointer-events-none absolute -bottom-10 -right-16 w-[230px] opacity-[0.16]" />
      <div className="relative">
        <div className="mb-3.5 font-mono text-[9.5px] font-semibold tracking-[0.13em] text-blue-soft">
          CONDUCT, AND WHAT WE DO NOT CLAIM
        </div>
        <p className="mb-4 max-w-[30ch] font-serif text-[21px] font-light leading-[1.35] text-white">
          You meet in a public place you chose. If anything feels wrong, you can leave.
        </p>

        <div className="mb-4 flex flex-col gap-3">
          <p className="border-l-2 border-[#4B7BF5] pl-3 font-sans text-[13.5px] leading-[1.5] text-white/80">
            Companions are men. They are listed under a pseudonym with a current
            photograph, and their real names are never shown.
          </p>
          <p className="border-l-2 border-[#F98CA2] pl-3 font-sans text-[13.5px] leading-[1.5] text-white/80">
            Your companion may end the booking immediately if the conduct terms are
            broken, with no refund. You agree to those terms in writing before you pay.
          </p>
          <p className="border-l-2 border-white/25 pl-3 font-sans text-[13.5px] leading-[1.5] text-white/80">
            We do not call anyone background-checked, because we do not run background
            checks. What we do have: a signed conduct agreement, a real photograph, and a
            record of every booking.
          </p>
        </div>

        <div className="mb-4 h-px bg-white/15" />

        <div className="flex flex-col gap-[7px] font-sans text-[12.5px] leading-[1.5] text-white/55">
          <p>
            Questions before you book, {SERVICE_HOURS_LABEL}:{' '}
            <a href={SUPPORT_PHONE_HREF} className="font-mono font-medium text-[#F98CA2]">
              {SUPPORT_PHONE}
            </a>
          </p>
          <nav className="mt-1 flex flex-wrap gap-3.5">
            <Link href="/policies/conduct" className="text-blue-soft">
              Conduct policy
            </Link>
            <Link href="/policies/refunds" className="text-blue-soft">
              Refunds
            </Link>
            <Link href="/policies/privacy" className="text-blue-soft">
              Privacy
            </Link>
            <Link href="/policies/terms" className="text-blue-soft">
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
