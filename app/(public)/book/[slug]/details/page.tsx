import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { getAvailability, getCompanion } from '@/lib/companions'
import { getSettings, offeredDurations } from '@/lib/settings'
import { formatPaise, quote } from '@/lib/booking/pricing'
import { formatSlotLabel } from '@/lib/time/zone'
import { StepBar } from '../_components/step-bar'
import { ContactForm } from './_components/contact-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Contact details', robots: { index: false } }

export default async function ContactDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ m?: string; t?: string }>
}) {
  const { slug } = await params
  const { m, t } = await searchParams

  const [companion, settings] = await Promise.all([getCompanion(slug), getSettings()])
  if (!companion) notFound()

  const minutes = offeredDurations(settings).includes(Number(m))
    ? Number(m)
    : settings.minDurationMinutes
  if (!t) redirect(`/book/${slug}?m=${minutes}`)

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

  // Where the preferences page will live
  const preferencesBase = `/book/${slug}/preferences?m=${minutes}&t=${encodeURIComponent(t)}`

  return (
    <>
      <PublicHeader
        back={{ href: `/book/${slug}?m=${minutes}&t=${encodeURIComponent(t)}`, label: 'Change time' }}
      />

      <div className="border-b border-ink/10 bg-white px-[18px] pb-5 pt-5">
        <StepBar current={2} />

        <h1 className="mb-1.5 mt-5 font-serif text-[28px] font-light leading-[1.15] text-ink">
          Your contact details
        </h1>
        <p className="font-sans text-[13px] leading-[1.55] text-ink/55">
          We use these only to arrange your booking and send your ticket.
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

      <ContactForm
        preferencesBase={preferencesBase}
        areas={companion.areaIds.map((id, i) => ({
          id,
          name: companion.areas[i] ?? 'Meeting area',
        }))}
      />
    </>
  )
}
