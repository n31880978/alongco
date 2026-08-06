'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { DigestDay } from '@/lib/companions'
import { cn } from '@/lib/utils'

/**
 * The live seven-day strip in the hero. Booking begins above the fold.
 *
 * Every label is formatted on the server in IST, so this component only picks —
 * it never does date maths, and a device with a wrong clock or a foreign
 * timezone still sees the right days.
 *
 * No countdown, no "only 2 left" (CLAUDE.md §9). The counts here are plain
 * facts, and a fully booked day says so rather than being hidden.
 */
export function HeroStrip({ days }: { days: DigestDay[] }) {
  const router = useRouter()
  const firstOpen = days.findIndex((d) => d.freeCount > 0)
  const [selected, setSelected] = useState(firstOpen === -1 ? 0 : firstOpen)

  const day = days[selected]

  // Three representative times, preferring ones that are actually free.
  const chips = useMemo(() => {
    if (!day) return []
    const free = day.times.filter((t) => t.free)
    const taken = day.times.filter((t) => !t.free)
    const picked = [...free.slice(0, 2), ...taken.slice(0, 1)]
    return (picked.length ? picked : day.times.slice(0, 3)).sort((a, b) =>
      a.value.localeCompare(b.value),
    )
  }, [day])

  const [time, setTime] = useState<string | null>(null)
  const activeTime = time ?? chips.find((c) => c.free)?.value ?? null
  const activeLabel = chips.find((c) => c.value === activeTime)?.label

  if (days.length === 0) {
    return (
      <div className="animate-rise rounded-xl border border-ink/10 bg-white/80 p-4 backdrop-blur-md [animation-delay:.44s]">
        <p className="font-sans text-[13.5px] leading-[1.5] text-ink/70">
          Nobody is taking bookings this week. Have a look at the profiles and check
          back — we list new companions before they open their calendars.
        </p>
        <Button
          onClick={() => router.push('/companions')}
          variant="ink"
          size="md"
          className="mt-3 w-full"
        >
          Browse companions
        </Button>
      </div>
    )
  }

  return (
    <div className="animate-rise rounded-xl border border-ink/10 bg-white/85 p-3.5 shadow-[0_10px_30px_rgba(22,22,26,.09)] backdrop-blur-md [animation-delay:.44s]">
      <div className="mb-[11px] flex items-center justify-between">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.12em] text-ink/45">
          WHEN SUITS YOU
        </span>
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.06em] text-blue">
          NEXT {days.length} DAYS
        </span>
      </div>

      <div className="mb-3 flex gap-1.5" role="tablist" aria-label="Choose a day">
        {days.map((d, i) => {
          const full = d.freeCount === 0
          const active = i === selected
          return (
            <button
              key={d.date}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setSelected(i)
                setTime(null)
              }}
              className={cn(
                'flex-1 rounded-lg py-2 text-center transition-colors',
                active
                  ? 'bg-ink'
                  : full
                    ? 'border border-ink/[.06] bg-paper-sunk'
                    : 'border border-ink/10 bg-white',
              )}
            >
              <span
                className={cn(
                  'block font-mono text-[8.5px] font-semibold',
                  active ? 'text-white/55' : full ? 'text-ink/25' : 'text-ink/40',
                )}
              >
                {d.weekday}
              </span>
              <span
                className={cn(
                  'mt-0.5 block font-sans text-[14px] font-semibold',
                  active ? 'text-white' : full ? 'text-ink/30' : 'text-ink',
                )}
              >
                {d.dayOfMonth}
              </span>
            </button>
          )
        })}
      </div>

      {day.freeCount === 0 ? (
        <p className="mb-3.5 font-sans text-[12.5px] leading-[1.5] text-ink/60">
          Every hour that day is taken. Try another day on the strip.
        </p>
      ) : (
        <div className="mb-3.5 flex gap-1.5">
          {chips.map((c) => (
            <button
              key={c.value}
              disabled={!c.free}
              onClick={() => setTime(c.value)}
              aria-label={c.free ? `${c.label}, free` : `${c.label}, taken`}
              className={cn(
                'flex-1 rounded-[7px] py-[9px] text-center font-mono text-[11.5px] font-semibold transition-colors',
                !c.free
                  ? 'cursor-not-allowed border border-ink/[.07] bg-paper-sunk text-ink/30 line-through'
                  : c.value === activeTime
                    ? 'border border-ink bg-ink text-white'
                    : 'border border-blue/20 bg-blue-tint text-blue-dark',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <Button
        sheen
        size="lg"
        className="w-full"
        onClick={() =>
          router.push(
            activeTime
              ? `/companions?d=${day.date}&t=${encodeURIComponent(activeTime)}`
              : `/companions?d=${day.date}`,
          )
        }
      >
        {activeLabel ? `See who is free at ${activeLabel}` : 'See who is free'}
      </Button>
    </div>
  )
}
