import Link from 'next/link'
import { Aurora } from '@/components/brand/aurora'
import { Wordmark } from '@/components/brand/mark'
import { Button } from '@/components/ui/button'
import { getAvailabilityDigest, listCompanions } from '@/lib/companions'
import { getSettings } from '@/lib/settings'
import { formatPaise, quote } from '@/lib/booking/pricing'
import { HeroStrip } from './_components/hero-strip'
import { TrackView } from '@/components/analytics/ga'

export const revalidate = 300

export default async function LandingPage() {
  const [companions, settings] = await Promise.all([listCompanions(), getSettings()])
  const accepting = companions.filter((c) => c.isAccepting)
  const digest = await getAvailabilityDigest(accepting, {
    durationMinutes: settings.minDurationMinutes,
  })

  const baseRate = accepting.length
    ? Math.min(...accepting.map((c) => c.hourlyRatePaise))
    : 49900

  const prices = [60, 120, 180].map((minutes) => ({
    minutes,
    ...quote(baseRate, minutes, settings.durationDiscounts),
  }))

  return (
    <>
      <TrackView event="view_landing" />
      {/* Hero — booking begins above the fold, over the drifting aurora. */}
      <section className="relative overflow-hidden bg-paper">
        <Aurora />
        <div className="relative px-5 pb-6 pt-4">
          <div className="mb-[26px] flex items-center justify-between">
            <Wordmark size={26} />
            <span className="rounded-full border border-blue/20 bg-white/70 px-2.5 py-[5px] font-mono text-[10px] font-semibold tracking-[0.06em] text-blue-dark backdrop-blur-sm">
              BANGALORE
            </span>
          </div>

          {accepting.length > 0 && (
            <div className="mb-4 inline-flex animate-rise items-center gap-2 rounded-full border border-ink/10 bg-white/75 py-1.5 pl-[9px] pr-[11px] shadow-[0_2px_10px_rgba(22,22,26,.05)] backdrop-blur-md">
              <span className="relative h-[7px] w-[7px] shrink-0">
                <span className="absolute inset-0 rounded-full bg-[#1F9D6B]" />
                <span className="absolute inset-0 animate-pulse2 rounded-full bg-[#1F9D6B]" />
              </span>
              <span className="font-mono text-[10.5px] font-semibold tracking-[0.04em] text-ink">
                {accepting.length} COMPANION{accepting.length === 1 ? '' : 'S'} TAKING
                BOOKINGS
              </span>
            </div>
          )}

          {/* The three-line break is the design's, at 375px. From md the lines
              become spans in a normally-wrapping heading, so a wider screen
              fills the measure instead of keeping a phone's ragged edge. */}
          <h1 className="mb-3.5 font-serif text-[36px] font-light leading-[1.08] tracking-[-0.02em] text-ink md:text-[52px] lg:text-[60px]">
            <span className="block animate-rise [animation-delay:.06s] md:inline">
              Someone to come{' '}
            </span>
            <span className="block animate-rise [animation-delay:.16s] md:inline">
              along, for an{' '}
            </span>
            <span className="block animate-rise [animation-delay:.26s] md:inline">
              hour.
            </span>
          </h1>

          <p className="mb-5 max-w-[310px] animate-rise font-sans text-[15px] leading-[1.55] text-ink/70 [animation-delay:.34s] [text-wrap:pretty] md:max-w-[46ch] md:text-[17px]">
            A public place you choose, an hour you booked, and a clear way to end it.{' '}
            <span className="font-semibold text-ink">
              {formatPaise(baseRate)} an hour.
            </span>
          </p>

          <HeroStrip days={digest} />

          <div className="mt-4 flex animate-rise flex-wrap items-center gap-x-3.5 gap-y-1.5 [animation-delay:.52s]">
            {[
              'Public places only',
              'No romance, at any price',
              'Total shown before you sign in',
            ].map((t, i) => (
              <span key={t} className="contents">
                {i > 0 && (
                  <span aria-hidden className="font-sans text-[11px] text-ink/30">
                    ·
                  </span>
                )}
                <span className="font-sans text-[11px] font-medium text-ink/60">{t}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* What it is / is not — the confidence argument, in order. */}
      <section
        className="border-t border-blue/15 bg-blue-tint px-5 py-6"
        style={{
          backgroundImage: 'radial-gradient(rgba(46,99,232,.11) 1px, transparent 1px)',
          backgroundSize: '15px 15px',
        }}
      >
        <SectionLabel colour="#2E63E8" tone="text-blue">
          WHAT THIS IS
        </SectionLabel>
        <ul className="mb-6 flex flex-col gap-[9px]">
          {[
            'A booked hour of company in a public place — a coffee, a film, a gallery, a walk.',
            'A fixed price you see before you enter any details.',
            'A ticket with a reference, so there is a record of what you booked.',
          ].map((t) => (
            <li
              key={t}
              className="flex gap-[11px] rounded-md bg-white px-[13px] py-3 font-sans text-[14px] leading-[1.45] text-ink shadow-[0_1px_2px_rgba(22,22,26,.05)]"
            >
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <SectionLabel colour="#E8557A" tone="text-rose-deep">
          WHAT THIS IS NOT
        </SectionLabel>
        <ul className="flex flex-col gap-[9px]">
          {[
            'Not a date, and not a step towards one.',
            'Nothing romantic or sexual is on offer, at any price.',
            'Not a friendship app. There is no chatting for weeks first.',
          ].map((t) => (
            <li
              key={t}
              className="flex gap-[11px] rounded-md bg-rose-tint px-[13px] py-3 font-sans text-[14px] leading-[1.45] text-ink"
            >
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 bg-[#E8557A]" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="border-t border-ink/10 bg-white px-5 pb-6 pt-[26px]">
        <div className="mb-[18px] flex items-center gap-2">
          <span
            aria-hidden
            className="h-0.5 w-3.5 bg-[linear-gradient(90deg,#2E63E8,#F76D8A)]"
          />
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.13em] text-ink/45">
            HOW IT WORKS
          </span>
        </div>
        <ol className="flex flex-col gap-4">
          {[
            {
              n: '01',
              rose: false,
              title: 'Choose a companion',
              body: 'Photo, rate, the areas he covers, and reviews from women who have actually met him.',
            },
            {
              n: '02',
              rose: false,
              title: 'Pick a time and a place',
              body: `Any free slot in the next ${settings.bookingWindowDays} days. You choose which of the three areas you meet in.`,
            },
            {
              n: '03',
              rose: true,
              title: 'Pay, and get your ticket',
              body: `Full amount upfront. We message you on WhatsApp within ${settings.confirmationSlaMinutes} minutes to confirm the details.`,
            },
          ].map((s) => (
            <li key={s.n} className="flex gap-[13px]">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${
                  s.rose ? 'bg-rose-tint text-rose-deep' : 'bg-blue-tint text-blue'
                }`}
              >
                {s.n}
              </span>
              <div>
                <div className="mb-[3px] font-sans text-[14.5px] font-semibold leading-[1.3] text-ink">
                  {s.title}
                </div>
                <p className="font-sans text-[13.5px] leading-[1.5] text-ink/60">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* What it costs */}
      <section className="border-t border-ink/10 bg-paper px-5 pb-[26px] pt-6">
        <div className="overflow-hidden rounded-[9px] border border-blue/20 bg-white shadow-[0_2px_10px_rgba(46,99,232,.08)]">
          <div className="h-[3px] bg-[linear-gradient(90deg,#2E63E8,#F76D8A)]" />
          <div className="border-b border-ink/10 bg-[#F7F9FE] px-4 pb-[11px] pt-3.5 font-mono text-[9.5px] font-semibold tracking-[0.13em] text-blue-dark">
            WHAT IT COSTS
          </div>
          {prices.map((p, i) => (
            <div
              key={p.minutes}
              className={`flex items-baseline justify-between px-4 py-[13px] ${
                i < prices.length - 1 ? 'border-b border-ink/[.07]' : ''
              }`}
            >
              <span className="font-sans text-[14px] text-ink">
                {p.minutes === 60
                  ? 'One hour'
                  : p.minutes === 120
                    ? 'Two hours'
                    : 'Three hours or more'}
                {p.discountPercent > 0 && (
                  <span className="ml-0.5 rounded-[3px] bg-rose-tint px-[5px] py-[3px] font-mono text-[10px] font-semibold text-rose-deep">
                    −{p.discountPercent}%
                  </span>
                )}
              </span>
              <span className="font-mono text-[15px] font-semibold text-ink">
                {formatPaise(p.amountPaise)}
              </span>
            </div>
          ))}
          <p className="border-t border-rose/20 bg-rose-tint px-4 pb-3.5 pt-3 font-sans text-[12.5px] leading-[1.5] text-ink/70">
            Full amount at checkout. Cancel 48 hours ahead for a full refund, 24 to 48
            hours for half. No refund inside 24 hours.
          </p>
        </div>

        <Button asChild size="lg" sheen className="mt-5 w-full">
          <Link href="/companions">See who is free</Link>
        </Button>
      </section>
    </>
  )
}

function SectionLabel({
  children,
  colour,
  tone,
}: {
  children: React.ReactNode
  colour: string
  tone: string
}) {
  return (
    <div className="mb-[13px] flex items-center gap-2">
      <span aria-hidden className="h-0.5 w-3.5" style={{ background: colour }} />
      <span
        className={`font-mono text-[9.5px] font-semibold tracking-[0.13em] ${tone}`}
      >
        {children}
      </span>
    </div>
  )
}
