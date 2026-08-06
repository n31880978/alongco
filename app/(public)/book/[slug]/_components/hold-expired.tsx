import Link from 'next/link'

/**
 * State C in the design canvas. PRD §6.4: she must never be charged for an
 * expired hold, and must be told so plainly rather than shown a generic error.
 */
export function HoldExpired({ slug }: { slug: string }) {
  return (
    <section className="bg-white px-[18px] py-5">
      <h1 className="mb-2 font-serif text-[21px] font-light leading-[1.25] text-ink">
        That slot went back on sale
      </h1>
      <p className="mb-3.5 font-sans text-[13px] leading-[1.5] text-ink/65">
        Holds last ten minutes so nobody else is blocked.{' '}
        <span className="font-semibold text-ink">You were not charged.</span> The time may
        well still be free — have another look.
      </p>
      <div className="flex gap-2">
        <Link
          href={`/book/${slug}`}
          className="flex h-[46px] flex-1 items-center justify-center rounded-lg bg-ink font-sans text-[13.5px] font-semibold text-white"
        >
          Pick a time again
        </Link>
        <Link
          href="/companions"
          className="flex h-[46px] flex-1 items-center justify-center rounded-lg border border-ink/15 font-sans text-[13.5px] font-semibold text-ink"
        >
          Other companions
        </Link>
      </div>
    </section>
  )
}
