import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { getAvailability, getCompanion } from '@/lib/companions'
import { getSettings, offeredDurations } from '@/lib/settings'
import { formatPaise, quote } from '@/lib/booking/pricing'
import { formatSlotLabel } from '@/lib/time/zone'
import { StepBar } from '../_components/step-bar'
import { PreferencesForm } from './_components/preferences-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your preferences', robots: { index: false } }

export default async function PreferencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    m?: string
    t?: string
    name?: string
    email?: string
    phone?: string
    area?: string
  }>
}) {
  const { slug } = await params
  const { m, t, name, email, phone, area } = await searchParams

  const [companion, settings] = await Promise.all([getCompanion(slug), getSettings()])
  if (!companion) notFound()

  const minutes = offeredDurations(settings).includes(Number(m))
    ? Number(m)
    : settings.minDurationMinutes

  // If any required contact fields are missing, bounce back to details
  if (!t || !name || !email || !phone) {
    redirect(`/book/${slug}/details?m=${minutes}${t ? `&t=${encodeURIComponent(t)}` : ''}`)
  }

  const days = await getAvailability(companion.id, { durationMinutes: minutes })
  const slot = days
    .flatMap((d) => d.slots)
    .find((s) => s.startsAt.toISOString() === t && s.available)
  if (!slot) redirect(`/book/${slug}?m=${minutes}`)

  const price = quote(companion.hourlyRatePaise, minutes, settings.durationDiscounts)

  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: settings.timezone,
  }).format(slot.startsAt)

  const timeLabel = `${formatSlotLabel(slot.startsAt, settings.timezone)}–${formatSlotLabel(slot.endsAt, settings.timezone)}`
  const durationLabel = `${minutes / 60} hour${minutes === 60 ? '' : 's'}`

  // Resolve area: use what was passed, fall back to the first area
  const areaId = companion.areaIds.includes(area ?? '')
    ? (area as string)
    : (companion.areaIds[0] ?? '')

  // Back link preserves all the contact data already entered
  const backHref = `/book/${slug}/details?m=${minutes}&t=${encodeURIComponent(t)}`

  return (
    <>
      <PublicHeader back={{ href: backHref, label: 'Back to contact details' }} />

      <div className="border-b border-ink/10 bg-white px-[18px] pb-5 pt-5">
        <StepBar current={3} />

        <h1 className="mb-1.5 mt-5 font-serif text-[28px] font-light leading-[1.15] text-ink">
          What are you looking for?
        </h1>
        <p className="font-sans text-[13px] leading-[1.55] text-ink/55">
          Help {companion.displayName} understand what would make this time special. Both
          fields are optional.
        </p>

        {/* Booking summary pill */}
        <div className="mt-4 overflow-hidden rounded-xl border border-blue/20 bg-blue-tint">
          <div className="flex items-stretch">
            <div className="flex flex-1 flex-col justify-center px-4 py-3.5">
              <p className="font-sans text-[14px] font-semibold text-ink">
                {companion.displayName}
              </p>
              <p className="mt-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink/50">
                {dateLabel}
              </p>
              <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink/50">
                {timeLabel} · {durationLabel}
              </p>
            </div>
            <div className="flex items-center justify-center border-l border-blue/15 bg-white/60 px-4">
              <span className="font-mono text-[18px] font-bold text-ink">
                {formatPaise(price.amountPaise)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <PreferencesForm
        slug={slug}
        startsAt={t}
        durationMinutes={minutes}
        areaId={areaId}
        fullName={name}
        email={email}
        phone={phone}
        companionName={companion.displayName}
      />
    </>
  )
}
