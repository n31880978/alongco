import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicHeader } from '@/components/site/header'
import { CompanionCard } from '@/components/site/companion-card'
import { getAvailabilityDigest, listAreas, listCompanions } from '@/lib/companions'
import { getSettings } from '@/lib/settings'
import { formatPaise } from '@/lib/booking/pricing'
import { formatSlotLabel, zonedDateKey } from '@/lib/time/zone'
import { AreaFilter } from './_components/area-filter'
import { TrackView } from '@/components/analytics/ga'

export const revalidate = 300

const BROWSE_DESCRIPTION =
  'Men listed under pseudonyms with current photographs, in MG Road, Indiranagar and Cubbon Park. A fixed hourly price, shown before you enter any details.'

export const metadata: Metadata = {
  title: 'Companions taking bookings',
  description: BROWSE_DESCRIPTION,
  // The area filter is a query parameter on this same page. Without an
  // explicit canonical, ?area=... would be indexed as several near-duplicate
  // pages competing with each other.
  alternates: { canonical: '/companions' },
  openGraph: {
    type: 'website',
    url: '/companions',
    title: 'Companions taking bookings · AlongCo',
    description: BROWSE_DESCRIPTION,
  },
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; d?: string; t?: string }>
}) {
  const params = await searchParams
  const [companions, areas, settings] = await Promise.all([
    listCompanions(),
    listAreas(),
    getSettings(),
  ])

  const accepting = companions.filter((c) => c.isAccepting)
  const digestByCompanion = await Promise.all(
    accepting.map(async (c) => ({
      id: c.id,
      digest: await getAvailabilityDigest([c], {
        durationMinutes: settings.minDurationMinutes,
      }),
    })),
  )

  const statusFor = (companionId: string) => {
    const entry = digestByCompanion.find((d) => d.id === companionId)
    if (!entry) return undefined
    const today = zonedDateKey(new Date(), settings.timezone)

    for (const day of entry.digest) {
      const firstFree = day.times.find((t) => t.free)
      if (!firstFree) continue
      if (day.date === today) {
        return {
          label: `FREE ${formatSlotLabel(new Date(firstFree.value), settings.timezone)
            .replace(':00', '')
            .replace(' ', '')}`,
          tone: 'free' as const,
        }
      }
      return { label: `NEXT: ${day.weekday}`, tone: 'later' as const }
    }
    return { label: 'FULL THIS WEEK', tone: 'later' as const }
  }

  const filtered = params.area
    ? companions.filter((c) => c.areas.includes(params.area!))
    : companions

  const cheapest = accepting.length
    ? Math.min(...accepting.map((c) => c.hourlyRatePaise))
    : null

  return (
    <>
      <TrackView event="view_browse" />
      <PublicHeader />

      <section className="border-b border-ink/10 bg-white px-[18px] pb-3.5 pt-[18px] md:px-8 md:pb-5 md:pt-8">
        <h1 className="mb-1.5 font-serif text-[25px] font-light leading-[1.2] text-ink md:text-[32px]">
          Taking bookings this week
        </h1>
        <p className="max-w-[62ch] font-sans text-[13px] leading-[1.5] text-ink/60 md:text-[14px]">
          {accepting.length === 0
            ? 'Nobody is open for bookings right now.'
            : `${spell(accepting.length)} ${accepting.length === 1 ? 'man' : 'men'}, listed under pseudonyms with current photographs.${
                cheapest ? ` From ${formatPaise(cheapest)} an hour.` : ''
              }`}
        </p>
      </section>

      <AreaFilter areas={areas.map((a) => a.name)} active={params.area ?? null} />

      <section className="px-[18px] pb-[18px] pt-3.5 md:px-8 md:pb-10 md:pt-5">
        {filtered.length === 0 ? (
          <EmptyState hasFilter={Boolean(params.area)} />
        ) : (
          /* One column on a phone, exactly as drawn. Two from md, three from
             lg — the card is a fixed-height row, so it tiles without any
             change to the card itself. */
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <CompanionCard
                key={c.id}
                companion={c}
                status={c.isAccepting ? statusFor(c.id) : undefined}
              />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-ink/20 bg-paper p-6 text-center">
      <p className="mb-1.5 font-sans text-[14px] font-semibold text-ink">
        {hasFilter ? 'Nobody covers that area yet' : 'No companions listed yet'}
      </p>
      <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
        {hasFilter
          ? 'We are adding companions area by area rather than listing men who cannot actually get there.'
          : 'We would rather show an empty page than pad it. Check back — new profiles go up before their calendars open.'}
      </p>
      {hasFilter && (
        <Link
          href="/companions"
          className="mt-3 inline-block font-sans text-[12.5px] font-semibold text-blue"
        >
          Show everyone
        </Link>
      )}
    </div>
  )
}

function spell(n: number): string {
  const words = [
    'No',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
  ]
  return words[n] ?? String(n)
}
