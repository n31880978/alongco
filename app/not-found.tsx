import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@/lib/contact'

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
}

/**
 * The 404 a customer actually reaches.
 *
 * Most often it is an unlisted or paused companion (PRD §6.1 — his profile
 * returns 404), or an old ticket link. So it offers the two things that are
 * useful in both cases rather than a bare "not found": somewhere to go, and
 * a way to reach a person.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center bg-paper px-[18px] py-12">
      <p className="mb-2 font-mono text-[10px] font-semibold tracking-[0.13em] text-ink/45">
        404
      </p>
      <h1 className="mb-3 font-serif text-[28px] font-light leading-[1.15] text-ink">
        We could not find that page
      </h1>
      <p className="mb-6 font-sans text-[14px] leading-[1.55] text-ink/65">
        The link may be old, or the companion may no longer be taking bookings. Your
        bookings and tickets are all still in your account.
      </p>

      <div className="flex flex-col gap-2.5">
        <Button asChild size="lg" className="w-full">
          <Link href="/companions">See who is taking bookings</Link>
        </Button>
        <Button asChild variant="outline" size="md" className="w-full">
          <Link href="/bookings">Your bookings</Link>
        </Button>
      </div>

      <p className="mt-6 border-t border-ink/10 pt-4 font-sans text-[12.5px] leading-[1.5] text-ink/55">
        If you were part-way through a booking and something went wrong, call us on{' '}
        <a href={SUPPORT_PHONE_HREF} className="font-mono font-medium text-ink">
          {SUPPORT_PHONE}
        </a>{' '}
        and we will sort it out by hand.
      </p>
    </main>
  )
}
