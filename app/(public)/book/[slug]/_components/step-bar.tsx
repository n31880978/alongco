'use client'

import { cn } from '@/lib/utils'

const STEPS = ['Time', 'Contact', 'Preferences', 'Pay'] as const

/**
 * 4-step progress indicator used across the booking journey.
 * Completed steps show a checkmark in green; the active step is blue; future steps are muted.
 */
export function StepBar({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <nav aria-label={`Booking step ${current} of 4`} className="flex items-center">
      {STEPS.map((label, i) => {
        const step = (i + 1) as 1 | 2 | 3 | 4
        const done = step < current
        const active = step === current
        const last = i === STEPS.length - 1
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full font-mono text-[11px] font-bold transition-colors',
                  done
                    ? 'bg-green text-white'
                    : active
                      ? 'bg-blue text-white shadow-[0_0_0_3px_rgba(46,99,232,0.18)]'
                      : 'border border-ink/15 bg-paper text-ink/35',
                )}
              >
                {done ? (
                  <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden>
                    <path
                      d="M1.5 5L5 8.5L11.5 1.5"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  step
                )}
              </span>
              <span
                className={cn(
                  'mt-1 font-mono text-[8px] font-semibold uppercase tracking-[.07em]',
                  active ? 'text-blue' : done ? 'text-green' : 'text-ink/30',
                )}
              >
                {label}
              </span>
            </div>
            {!last && (
              <div
                className={cn(
                  'mb-[14px] mx-1.5 h-px flex-1',
                  done ? 'bg-green/40' : 'bg-ink/10',
                )}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
