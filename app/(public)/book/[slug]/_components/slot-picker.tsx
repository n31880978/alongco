'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { holdSlot, type HoldState } from '../actions'

type Slot = {
  value: string
  label: string
  endLabel: string
  available: boolean
}

type Duration = {
  minutes: number
  label: string
  price: string
  discountPercent: number
  href: string
  active: boolean
}

/**
 * Time chips, duration, and the Continue bar.
 *
 * Taken slots stay on screen greyed out rather than disappearing (PRD §6.2) —
 * the cinema-seat model. Every price shown here was computed on the server from
 * the stored rate; this component never does money arithmetic.
 */
export function SlotPicker({
  slug,
  day,
  nextFreeDate,
  preselect,
  durationMinutes,
  areaId,
  amountLabel,
  durations,
  bufferMinutes,
}: {
  slug: string
  day: { date: string; label: string; slots: Slot[] } | null
  nextFreeDate: { date: string; label: string; href: string } | null
  preselect: string | null
  durationMinutes: number
  areaId: string
  amountLabel: string
  durations: Duration[]
  bufferMinutes: number
}) {
  const router = useRouter()
  const [state, submit] = useActionState<HoldState, FormData>(holdSlot, {})

  const firstFree = day?.slots.find((s) => s.available)?.value ?? null
  const preselectValid =
    preselect && day?.slots.some((s) => s.value === preselect && s.available)
      ? preselect
      : null

  const [selected, setSelected] = useState<string | null>(preselectValid ?? firstFree)

  // Keep the selection valid when the day or duration changes underneath it.
  useEffect(() => {
    setSelected((current) => {
      if (current && day?.slots.some((s) => s.value === current && s.available)) {
        return current
      }
      return day?.slots.find((s) => s.available)?.value ?? null
    })
  }, [day])

  // "That slot was just taken" — refetch so she sees the truth, not a stale grid.
  useEffect(() => {
    if (state.refresh) router.refresh()
  }, [state.refresh, router])

  const chosen = day?.slots.find((s) => s.value === selected) ?? null
  const freeCount = day?.slots.filter((s) => s.available).length ?? 0

  return (
    <>
      <section className="border-b border-ink/10 bg-white px-[18px] py-4">
        <div className="mb-[11px] flex items-center justify-between">
          <span className="font-mono text-[9px] font-semibold tracking-[0.12em] text-ink/45">
            {day?.label ?? ''}
          </span>
          {day && (
            <span className="font-mono text-[9px] font-medium text-ink/40">
              {freeCount} OF {day.slots.length} FREE
            </span>
          )}
        </div>

        {day && freeCount === 0 ? (
          <FullDay date={day.label} next={nextFreeDate} />
        ) : (
          <div className="grid grid-cols-3 gap-[7px]">
            {day?.slots.map((slot) => {
              const isChosen = slot.value === selected
              return (
                <button
                  key={slot.value}
                  type="button"
                  disabled={!slot.available}
                  aria-pressed={isChosen}
                  aria-label={
                    slot.available
                      ? `${slot.label} to ${slot.endLabel}`
                      : `${slot.label}, already taken`
                  }
                  onClick={() => setSelected(slot.value)}
                  className={cn(
                    'rounded-[7px] py-[11px] text-center font-mono text-[12px] font-semibold transition-colors',
                    !slot.available
                      ? 'cursor-not-allowed border border-ink/[.07] bg-paper-sunk text-ink/30 line-through'
                      : isChosen
                        ? 'border border-ink bg-ink text-white shadow-[0_4px_12px_rgba(22,22,26,.2)]'
                        : 'border border-blue/20 bg-blue-tint text-blue-dark',
                  )}
                >
                  {slot.label}
                </button>
              )
            })}
          </div>
        )}

        {day && freeCount > 0 && (
          <div className="mt-3 flex gap-3.5">
            <Legend className="border border-blue/30 bg-blue-tint">FREE</Legend>
            <Legend className="bg-ink">CHOSEN</Legend>
            <Legend className="border border-ink/15 bg-paper-sunk">TAKEN</Legend>
          </div>
        )}
      </section>

      {/* How long */}
      <section className="border-b border-blue/15 bg-blue-tint px-[18px] py-4">
        <div className="mb-2.5 font-mono text-[9px] font-semibold tracking-[0.12em] text-blue">
          HOW LONG
        </div>
        <div className="flex gap-[7px]">
          {durations.map((d) => (
            <Link
              key={d.minutes}
              href={d.href}
              scroll={false}
              aria-current={d.active ? 'true' : undefined}
              className={cn(
                'flex-1 rounded-lg bg-white py-2.5 text-center',
                d.active ? 'border-[1.5px] border-blue' : 'border border-ink/[.12]',
              )}
            >
              <span className="block font-sans text-[13px] font-semibold text-ink">
                {d.label}
              </span>
              <span className="mt-[3px] block font-mono text-[10px] font-semibold text-ink">
                {d.price}
                {d.discountPercent > 0 && (
                  <span className="text-rose-deep"> −{d.discountPercent}%</span>
                )}
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-2 font-sans text-[11.5px] leading-[1.5] text-ink/55">
          No extensions once the hour starts. There is a {bufferMinutes}-minute gap after
          every booking.
        </p>
      </section>

      {/* Continue */}
      <section className="bg-white px-[18px] pb-4 pt-[13px] shadow-[0_-6px_18px_rgba(22,22,26,.06)]">
        {state.error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-rose/25 bg-rose-tint px-3 py-2.5 font-sans text-[12.5px] leading-[1.45] text-ink/80"
          >
            {state.error}
          </p>
        )}

        <div className="mb-[11px] flex items-baseline justify-between gap-3">
          <div>
            <div className="font-sans text-[13.5px] font-semibold text-ink">
              {chosen
                ? `${shortDate(day!.label)}, ${chosen.label}–${chosen.endLabel}`
                : 'No time chosen yet'}
            </div>
            <div className="mt-0.5 font-mono text-[10px] font-medium uppercase text-ink/45">
              {durationMinutes / 60} HOUR{durationMinutes === 60 ? '' : 'S'}
            </div>
          </div>
          <div className="font-mono text-[19px] font-semibold text-ink">{amountLabel}</div>
        </div>

        <form action={submit}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="startsAt" value={selected ?? ''} />
          <input type="hidden" name="durationMinutes" value={durationMinutes} />
          <input type="hidden" name="areaId" value={areaId} />
          <ContinueButton disabled={!selected} />
        </form>

        <p className="mt-2 text-center font-sans text-[11.5px] text-ink/50">
          Nothing is charged yet. We hold the slot for ten minutes while you decide.
        </p>
      </section>
    </>
  )
}

function ContinueButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" sheen disabled={disabled || pending} className="w-full">
      {pending ? 'Holding your slot…' : 'Continue'}
    </Button>
  )
}

function Legend({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className="flex items-center gap-[5px] font-mono text-[9.5px] font-medium text-ink/50">
      <span aria-hidden className={cn('h-[9px] w-[9px] rounded-[2px]', className)} />
      {children}
    </span>
  )
}

/**
 * The fully-booked empty state. It offers the next free date rather than a dead
 * end — and states plainly that the day is full, with no scarcity framing.
 */
function FullDay({
  date,
  next,
}: {
  date: string
  next: { date: string; label: string; href: string } | null
}) {
  return (
    <div>
      <p className="mb-3.5 font-sans text-[13px] leading-[1.5] text-ink/65">
        Every hour on {titleCase(date)} is taken.
        {next ? (
          <>
            {' '}
            His next free slot is{' '}
            <span className="font-semibold text-ink">{next.label}</span>.
          </>
        ) : (
          ' He has nothing free in the rest of the booking window.'
        )}
      </p>
      <div className="flex gap-2">
        {next && (
          <Link
            href={next.href}
            scroll={false}
            className="flex h-[46px] flex-1 items-center justify-center rounded-lg bg-ink font-sans text-[13.5px] font-semibold text-white"
          >
            Take {next.label.split(' ')[0]}
          </Link>
        )}
        <Link
          href="/companions"
          className="flex h-[46px] flex-1 items-center justify-center rounded-lg border border-blue/30 font-sans text-[13.5px] font-semibold text-blue-dark"
        >
          Other companions
        </Link>
      </div>
    </div>
  )
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function shortDate(label: string): string {
  // 'SATURDAY 8 AUGUST' -> 'Sat 8 Aug'
  const [weekday, day, month] = titleCase(label).split(' ')
  return `${weekday?.slice(0, 3)} ${day} ${month?.slice(0, 3)}`
}
