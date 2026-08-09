'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Slot = { value: string; label: string; endLabel: string; available: boolean }
type Duration = {
  minutes: number
  label: string
  price: string
  discountPercent: number
  href: string
  active: boolean
}

/** Step one of the booking journey: choose, then move on to a dedicated details page. */
export function SlotPicker({
  slug, day, nextFreeDate, preselect, durationMinutes, amountLabel, durations,
}: {
  slug: string
  day: { date: string; label: string; slots: Slot[] } | null
  nextFreeDate: { date: string; label: string; href: string } | null
  preselect: string | null
  durationMinutes: number
  amountLabel: string
  durations: Duration[]
  bufferMinutes: number
  areas: { id: string; name: string }[]
  areaId: string
}) {
  const firstFree = day?.slots.find((slot) => slot.available)?.value ?? null
  const validPreselect = preselect && day?.slots.some((slot) => slot.value === preselect && slot.available)
    ? preselect : null
  const [selected, setSelected] = useState<string | null>(validPreselect ?? firstFree)

  useEffect(() => {
    setSelected((current) => current && day?.slots.some((slot) => slot.value === current && slot.available)
      ? current : day?.slots.find((slot) => slot.available)?.value ?? null)
  }, [day])

  const chosen = day?.slots.find((slot) => slot.value === selected) ?? null
  const freeCount = day?.slots.filter((slot) => slot.available).length ?? 0
  const detailsHref = selected
    ? `/book/${slug}/details?m=${durationMinutes}&t=${encodeURIComponent(selected)}`
    : '#times'

  return (
    <>
      <section id="times" className="border-b border-ink/10 bg-white px-[18px] py-4">
        <div className="mb-[11px] flex items-center justify-between">
          <span className="font-mono text-[9px] font-semibold tracking-[0.12em] text-ink/45">{day?.label ?? ''}</span>
          {day && <span className="font-mono text-[9px] font-medium text-ink/40">{freeCount} OF {day.slots.length} FREE</span>}
        </div>
        {day && freeCount === 0 ? <FullDay date={day.label} next={nextFreeDate} /> : (
          <div className="grid grid-cols-3 gap-[7px]">
            {day?.slots.map((slot) => {
              const picked = slot.value === selected
              return <button key={slot.value} type="button" disabled={!slot.available} aria-pressed={picked}
                onClick={() => setSelected(slot.value)}
                className={cn('rounded-[7px] py-[11px] text-center font-mono text-[12px] font-semibold transition-colors',
                  !slot.available ? 'cursor-not-allowed border border-ink/[.07] bg-paper-sunk text-ink/30 line-through' :
                  picked ? 'border border-ink bg-ink text-white shadow-[0_4px_12px_rgba(22,22,26,.2)]' : 'border border-blue/20 bg-blue-tint text-blue-dark')}>
                {slot.label}
              </button>
            })}
          </div>
        )}
      </section>

      <section className="border-b border-blue/15 bg-blue-tint px-[18px] py-4">
        <div className="mb-2.5 font-mono text-[9px] font-semibold tracking-[0.12em] text-blue">HOW LONG</div>
        <div className="flex gap-[7px]">
          {durations.map((duration) => <Link key={duration.minutes} href={duration.href} scroll={false}
            className={cn('flex-1 rounded-lg bg-white py-2.5 text-center', duration.active ? 'border-[1.5px] border-blue' : 'border border-ink/[.12]')}>
            <span className="block font-sans text-[13px] font-semibold text-ink">{duration.label}</span>
            <span className="mt-[3px] block font-mono text-[10px] font-semibold text-ink">{duration.price}{duration.discountPercent > 0 && <span className="text-rose-deep"> −{duration.discountPercent}%</span>}</span>
          </Link>)}
        </div>
      </section>

      <section className="bg-white px-[18px] pb-5 pt-4 shadow-[0_-6px_18px_rgba(22,22,26,.06)]">
        <div className="mb-3 flex items-center justify-between rounded-xl border border-ink/10 bg-paper px-3.5 py-3">
          <div>
            <p className="font-sans text-[13.5px] font-semibold text-ink">
              {chosen ? `${shortDate(day!.label)} · ${chosen.label}–${chosen.endLabel}` : 'Choose a time to continue'}
            </p>
            <p className="mt-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.05em] text-ink/40">
              Step 1 of 4 · Time &amp; duration
            </p>
          </div>
          <span className="font-mono text-[18px] font-semibold text-ink">{amountLabel}</span>
        </div>
        {selected
          ? <Link href={detailsHref} className="block"><Button size="lg" sheen className="w-full">Continue to your details</Button></Link>
          : <Button size="lg" disabled className="w-full">Choose a time to continue</Button>
        }
        <p className="mt-2.5 text-center font-sans text-[11.5px] text-ink/45">
          Your slot is not held until the next step.
        </p>
      </section>
    </>
  )
}

function FullDay({ date, next }: { date: string; next: { label: string; href: string } | null }) {
  return <div><p className="mb-3.5 font-sans text-[13px] leading-[1.5] text-ink/65">Every hour on {titleCase(date)} is taken.{next ? <> His next free slot is <span className="font-semibold text-ink">{next.label}</span>.</> : ' He has nothing free in the rest of the booking window.'}</p><div className="flex gap-2">{next && <Link href={next.href} scroll={false} className="flex h-[46px] flex-1 items-center justify-center rounded-lg bg-ink font-sans text-[13.5px] font-semibold text-white">Take {next.label.split(' ')[0]}</Link>}<Link href="/companions" className="flex h-[46px] flex-1 items-center justify-center rounded-lg border border-blue/30 font-sans text-[13.5px] font-semibold text-blue-dark">Other companions</Link></div></div>
}

function shortDate(s: string) { return titleCase(s).replace(/,?\s*\d{4}/, '') }
function titleCase(s: string) { return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) }
