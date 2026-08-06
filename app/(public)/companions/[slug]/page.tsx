import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Mark } from '@/components/brand/mark'
import { getCompanion, summariseRules } from '@/lib/companions'
import { formatPaise } from '@/lib/booking/pricing'
import { TrackView } from '@/components/analytics/ga'

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const companion = await getCompanion(slug)
  if (!companion) return { title: 'Not found' }
  return {
    title: `${companion.displayName} — ${formatPaise(companion.hourlyRatePaise)} an hour`,
    description: companion.bio ?? undefined,
  }
}

export default async function CompanionProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const companion = await getCompanion(slug)

  // RLS returns nothing for an inactive companion, so this is the 404 in
  // PRD §6.1 rather than a separate is_active check that could drift.
  if (!companion) notFound()

  const hours = summariseRules(companion.rules)

  return (
    <>
      <TrackView event="view_profile" companionSlug={slug} />
      {/* Portrait */}
      <div className="relative h-[280px] overflow-hidden bg-[#dfe6f8]">
        {companion.photoUrl ? (
          <Image
            src={companion.photoUrl}
            alt={companion.displayName}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 560px"
            className="object-cover"
          />
        ) : (
          <>
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'repeating-linear-gradient(128deg, rgba(46,99,232,.13) 0 9px, rgba(46,99,232,0) 9px 18px)',
              }}
            />
            <Mark className="absolute left-1/2 top-[48%] w-[250px] -translate-x-1/2 -translate-y-1/2 opacity-20" />
          </>
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(15,16,20,.45), rgba(15,16,20,0) 34%, rgba(15,16,20,.55))',
          }}
        />
        <Link
          href="/companions"
          aria-label="Back to companions"
          className="absolute left-3.5 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-[17px] leading-none text-ink backdrop-blur-sm"
        >
          ‹
        </Link>
        {!companion.photoUrl && (
          <span className="absolute bottom-3.5 left-[18px] font-mono text-[9px] font-medium tracking-[0.08em] text-white/80">
            PHOTOGRAPH TO COME · CURRENT PHOTOGRAPH ONLY
          </span>
        )}
      </div>

      <div className="h-[3px] bg-[linear-gradient(90deg,#2E63E8,#8A6BEF_45%,#F76D8A)]" />

      {/* Identity + bio */}
      <section className="border-b border-ink/10 bg-white px-[18px] pb-4 pt-[18px]">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h1 className="font-serif text-[28px] font-light leading-[1.15] text-ink">
            {companion.displayName}
          </h1>
          <span className="shrink-0 font-mono text-[16px] font-semibold text-ink">
            {formatPaise(companion.hourlyRatePaise)}
            <span className="font-mono text-[10px] font-medium text-ink/45">/HR</span>
          </span>
        </div>

        {companion.reviewCount > 0 && (
          <div className="mb-[13px] flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-ink">
              {companion.averageRating?.toFixed(1)}
            </span>
            <span className="font-sans text-[11.5px] text-ink/55">
              · {companion.reviewCount} verified review
              {companion.reviewCount === 1 ? '' : 's'}
            </span>
          </div>
        )}

        {companion.bio && (
          <p className="font-sans text-[14px] leading-[1.55] text-ink/70">
            {companion.bio}
          </p>
        )}
      </section>

      {/* Facts */}
      <section className="grid grid-cols-2 gap-3 border-b border-ink/10 bg-paper px-[18px] py-4">
        <Fact label="AREAS HE COVERS">
          {companion.areas.join(', ') || 'To be confirmed'}
        </Fact>
        <Fact label="USUAL HOURS">{hours ?? 'No hours set yet'}</Fact>
      </section>

      {/* The boundary, stated before she books — not buried in terms */}
      <section className="border-b border-rose/20 bg-rose-tint px-[18px] py-4">
        <div className="mb-1.5 font-mono text-[9px] font-semibold tracking-[0.12em] text-rose-deep">
          BEFORE YOU BOOK HIM
        </div>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/70">
          Public places only. Nothing romantic or sexual is offered or permitted, and he
          may end the booking immediately for a breach, with no refund. We do not
          describe him as verified or background-checked.
        </p>
      </section>

      {/* Reviews */}
      <section className="bg-white px-[18px] pb-4 pt-[18px]">
        <div className="mb-3.5 flex items-center justify-between">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.13em] text-ink/45">
            REVIEWS FROM COMPLETED BOOKINGS
          </span>
          {companion.reviewCount > 2 && (
            <span className="font-mono text-[9.5px] font-semibold text-blue">
              ALL {companion.reviewCount}
            </span>
          )}
        </div>

        {companion.reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink/20 bg-paper p-3.5">
            <p className="mb-[5px] font-sans text-[12.5px] font-semibold text-ink">
              No reviews yet
            </p>
            <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
              He has not completed a booking through AlongCo yet, so there is nothing
              real to show. We would rather show nothing than a rating of zero.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-[13px]">
            {companion.reviews.slice(0, 6).map((r, i) => (
              <li
                key={r.id}
                className={`border-l-2 pl-3 ${i === 0 ? 'border-blue' : 'border-ink/15'}`}
              >
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="font-mono text-[10px] font-semibold text-ink">
                    {r.rating.toFixed(1)}
                  </span>
                  <span className="font-mono text-[9.5px] font-medium uppercase text-ink/40">
                    {new Intl.DateTimeFormat('en-IN', {
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'Asia/Kolkata',
                    }).format(new Date(r.createdAt))}
                  </span>
                </div>
                {r.body && (
                  <p className="font-sans text-[13px] leading-[1.5] text-ink/70">
                    {r.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Call to action */}
      <section className="border-t border-ink/10 bg-white px-[18px] pb-4 pt-[13px] shadow-[0_-6px_18px_rgba(22,22,26,.06)]">
        {companion.isAccepting ? (
          <>
            <Button asChild sheen size="lg" className="w-full">
              <Link href={`/book/${companion.slug}`}>Check his availability</Link>
            </Button>
            <p className="mt-2 text-center font-sans text-[11.5px] text-ink/50">
              Nothing is charged until you accept the terms and pay.
            </p>
          </>
        ) : (
          <div className="rounded-lg border border-amber/20 bg-amber-tint p-3.5">
            <div className="mb-1.5 font-mono text-[9px] font-semibold tracking-[0.1em] text-amber">
              NOT TAKING BOOKINGS
            </div>
            <p className="mb-3 font-sans text-[12.5px] leading-[1.5] text-ink/70">
              {companion.displayName} has paused his availability. You can still read his
              profile, and other companions are open this week.
            </p>
            <Button disabled size="md" variant="outline" className="w-full">
              Check his availability
            </Button>
            <Link
              href="/companions"
              className="mt-2 block text-center font-sans text-[12.5px] font-semibold text-blue"
            >
              See who is open
            </Link>
          </div>
        )}
      </section>
    </>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[5px] font-mono text-[9px] font-semibold tracking-[0.12em] text-ink/45">
        {label}
      </div>
      <div className="font-sans text-[13px] font-semibold text-ink">{children}</div>
    </div>
  )
}
