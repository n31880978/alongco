import Link from 'next/link'

/**
 * Shown when the 10-minute hold has lapsed before payment completed.
 * PRD §6.4: the customer must never be charged and must be told plainly.
 */
export function HoldExpired({ slug }: { slug: string }) {
  return (
    <section className="bg-white px-[18px] py-6">
      <div className="mb-4 rounded-xl border border-amber/20 bg-amber-tint px-4 py-3">
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-amber">
          Hold ended
        </p>
      </div>

      <h1 className="mb-2 font-serif text-[24px] font-light leading-[1.2] text-ink">
        That slot went back on sale
      </h1>
      <p className="mb-5 font-sans text-[13px] leading-[1.55] text-ink/65">
        Holds last ten minutes so nobody else is blocked indefinitely.{' '}
        <span className="font-semibold text-ink">You were not charged.</span> The time may
        still be free — have another look.
      </p>

      <div className="flex gap-2.5">
        <Link
          href={`/book/${slug}`}
          className="flex h-[50px] flex-1 items-center justify-center rounded-xl bg-ink font-sans text-[13.5px] font-semibold text-white"
        >
          Pick a time again
        </Link>
        <Link
          href="/companions"
          className="flex h-[50px] flex-1 items-center justify-center rounded-xl border border-ink/15 font-sans text-[13.5px] font-semibold text-ink hover:bg-paper-warm"
        >
          Other companions
        </Link>
      </div>
    </section>
  )
}
