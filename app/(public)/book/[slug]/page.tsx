import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { getAvailability, getCompanion } from '@/lib/companions'
import { getSettings, offeredDurations } from '@/lib/settings'
import { formatPaise, quote } from '@/lib/booking/pricing'
import { nextAvailableDate } from '@/lib/booking/availability'
import { formatSlotLabel, zonedDateKey, zonedParts } from '@/lib/time/zone'
import { SlotPicker } from './_components/slot-picker'
import { cn } from '@/lib/utils'
import { TrackView } from '@/components/analytics/ga'

// The hold and the slot grid must reflect the database right now, never a
// cached copy — a stale grid is how two people pick the same time.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const companion = await getCompanion(slug)
  return {
    title: companion ? `Book ${companion.displayName}` : 'Not found',
    robots: { index: false },
  }
}

export default async function SlotPickerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ m?: string; d?: string; t?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams

  const [companion, settings] = await Promise.all([getCompanion(slug), getSettings()])
  if (!companion) notFound()

  const durations = offeredDurations(settings)
  const requested = Number(sp.m)
  const durationMinutes = durations.includes(requested)
    ? requested
    : settings.minDurationMinutes

  // Price is computed here, on the server, from the companion's stored rate —
  // the same rule ac_quote() applies when the hold is created (§3.1).
  const price = quote(companion.hourlyRatePaise, durationMinutes, settings.durationDiscounts)

  const days = await getAvailability(companion.id, { durationMinutes })
  const selectedDate =
    days.find((d) => d.date === sp.d)?.date ??
    days.find((d) => d.hasAvailable)?.date ??
    days[0]?.date ??
    null

  const day = days.find((d) => d.date === selectedDate) ?? null
  const nextFree = day && !day.hasAvailable ? nextAvailableDate(days, day.date) : null

  const hrefFor = (next: { m?: number; d?: string }) => {
    const q = new URLSearchParams()
    q.set('m', String(next.m ?? durationMinutes))
    if (next.d ?? selectedDate) q.set('d', next.d ?? selectedDate!)
    return `/book/${slug}?${q}`
  }

  const monthLabel = day
    ? new Intl.DateTimeFormat('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: settings.timezone,
      })
        .format(new Date(`${day.date}T12:00:00+05:30`))
        .toUpperCase()
    : ''

  return (
    <>
      <TrackView event="select_slot" companionSlug={slug} />
      <PublicHeader
        back={{
          href: `/companions/${slug}`,
          label: companion.displayName,
          subtitle: `${formatPaise(companion.hourlyRatePaise)}/HR · ${companion.areas.join(', ')}`,
        }}
      />

      <section className="border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px]">
        <h1 className="mb-[5px] font-serif text-[24px] font-light leading-[1.2] text-ink">
          Pick a day and a time
        </h1>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
          Times already taken stay on screen, greyed out. Service hours{' '}
          {friendlyHour(settings.serviceHours.start)} to{' '}
          {friendlyHour(settings.serviceHours.end)}, {settings.bookingWindowDays} days
          ahead.
        </p>
      </section>

      {!companion.isAccepting ? (
        <PausedState name={companion.displayName} slug={slug} />
      ) : days.length === 0 ? (
        <NoHoursState name={companion.displayName} />
      ) : (
        <>
          {/* Date strip */}
          <section className="border-b border-ink/10 bg-paper px-[18px] py-3.5">
            <div className="mb-2.5 font-mono text-[9px] font-semibold tracking-[0.12em] text-ink/45">
              {monthLabel}
            </div>
            <div className="ac-scroll-x flex gap-1.5">
              {days.map((d) => {
                const active = d.date === selectedDate
                const parts = zonedParts(
                  new Date(`${d.date}T12:00:00+05:30`),
                  settings.timezone,
                )
                const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
                return (
                  <Link
                    key={d.date}
                    href={hrefFor({ d: d.date })}
                    scroll={false}
                    aria-current={active ? 'date' : undefined}
                    className={cn(
                      'min-w-[46px] flex-1 rounded-lg py-[9px] text-center',
                      active
                        ? 'bg-ink'
                        : d.hasAvailable
                          ? 'border border-ink/10 bg-white'
                          : 'border border-ink/[.06] bg-paper-sunk',
                    )}
                  >
                    <span
                      className={cn(
                        'block font-mono text-[8.5px] font-semibold',
                        active
                          ? 'text-white/55'
                          : d.hasAvailable
                            ? 'text-ink/40'
                            : 'text-ink/25',
                      )}
                    >
                      {names[parts.weekday]}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block font-sans text-[15px] font-semibold',
                        active
                          ? 'text-white'
                          : d.hasAvailable
                            ? 'text-ink'
                            : 'text-ink/30',
                      )}
                    >
                      {parts.day}
                    </span>
                    {d.hasAvailable ? (
                      <span
                        aria-hidden
                        className={cn(
                          'mx-auto mt-1 block h-1 w-1 rounded-full',
                          active ? 'bg-rose' : 'bg-blue',
                        )}
                      />
                    ) : (
                      <span className="mt-1 block font-mono text-[7px] font-medium text-ink/30">
                        FULL
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </section>

          <SlotPicker
            slug={slug}
            day={
              day
                ? {
                    date: day.date,
                    label: new Intl.DateTimeFormat('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      timeZone: settings.timezone,
                    })
                      .format(new Date(`${day.date}T12:00:00+05:30`))
                      .toUpperCase(),
                    slots: day.slots.map((s) => ({
                      value: s.startsAt.toISOString(),
                      label: formatSlotLabel(s.startsAt, settings.timezone),
                      endLabel: formatSlotLabel(s.endsAt, settings.timezone),
                      available: s.available,
                    })),
                  }
                : null
            }
            nextFreeDate={
              nextFree
                ? {
                    date: nextFree,
                    label: new Intl.DateTimeFormat('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      timeZone: settings.timezone,
                    }).format(new Date(`${nextFree}T12:00:00+05:30`)),
                    href: hrefFor({ d: nextFree }),
                  }
                : null
            }
            preselect={sp.t ?? null}
            durationMinutes={durationMinutes}
            areaId={companion.areaIds[0] ?? ''}
            amountLabel={formatPaise(price.amountPaise)}
            durations={durations.map((m) => {
              const q = quote(companion.hourlyRatePaise, m, settings.durationDiscounts)
              return {
                minutes: m,
                label: `${m / 60} hour${m === 60 ? '' : 's'}`,
                price: formatPaise(q.amountPaise),
                discountPercent: q.discountPercent,
                href: hrefFor({ m }),
                active: m === durationMinutes,
              }
            })}
            bufferMinutes={settings.bufferMinutes}
          />
        </>
      )}
    </>
  )
}

function friendlyHour(hhmm: string): string {
  const [h] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`
}

function PausedState({ name, slug }: { name: string; slug: string }) {
  return (
    <section className="bg-white px-[18px] py-5">
      <div className="rounded-lg border border-amber/20 bg-amber-tint p-3.5">
        <div className="mb-1.5 font-mono text-[9px] font-semibold tracking-[0.1em] text-amber">
          NOT TAKING BOOKINGS
        </div>
        <p className="mb-3 font-sans text-[12.5px] leading-[1.5] text-ink/70">
          {name} has paused his availability. Nothing was held and nothing was charged.
        </p>
        <div className="flex gap-2">
          <Link
            href="/companions"
            className="flex h-[46px] flex-1 items-center justify-center rounded-lg bg-ink font-sans text-[13.5px] font-semibold text-white"
          >
            Other companions
          </Link>
          <Link
            href={`/companions/${slug}`}
            className="flex h-[46px] flex-1 items-center justify-center rounded-lg border border-ink/15 font-sans text-[13.5px] font-semibold text-ink"
          >
            Back to profile
          </Link>
        </div>
      </div>
    </section>
  )
}

function NoHoursState({ name }: { name: string }) {
  return (
    <section className="bg-white px-[18px] py-5">
      <div className="rounded-lg border border-dashed border-ink/20 bg-paper p-4">
        <p className="mb-1.5 font-sans text-[13px] font-semibold text-ink">
          No times in the next few days
        </p>
        <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
          {name} has no hours set for this week. Have a look at who else is open.
        </p>
        <Link
          href="/companions"
          className="mt-3 inline-block font-sans text-[12.5px] font-semibold text-blue"
        >
          See who is free
        </Link>
      </div>
    </section>
  )
}
