'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * How long the hold has left.
 *
 * This is not a pressure device (CLAUDE.md §9) — it is the plain fact that the
 * slot is reserved for ten minutes so nobody else is blocked indefinitely. It
 * stays amber throughout, never turns red, and never counts down against an
 * offer or a discount.
 *
 * The server is the source of truth: on expiry this refreshes the route rather
 * than deciding anything itself, and a page reload always re-reads the real
 * hold_expires_at (§9 — no localStorage for booking state).
 */
export function HoldTimer({ expiresAt }: { expiresAt: string }) {
  const router = useRouter()
  const [remaining, setRemaining] = useState(() => msLeft(expiresAt))

  useEffect(() => {
    setRemaining(msLeft(expiresAt))
    const id = setInterval(() => {
      const left = msLeft(expiresAt)
      setRemaining(left)
      if (left <= 0) {
        clearInterval(id)
        // Let the server decide what an expired hold means.
        router.refresh()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, router])

  const expired = remaining <= 0

  return (
    <div className="flex items-center justify-between border-b border-amber/20 bg-amber-tint px-[18px] py-[11px]">
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${expired ? 'bg-amber/40' : 'bg-amber'}`} aria-hidden />
        <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-amber">
          {expired ? 'THIS HOLD HAS ENDED' : 'SLOT HELD FOR YOU'}
        </span>
      </div>
      <span
        className="font-mono text-[13px] font-bold text-amber"
        role="timer"
        aria-live="off"
      >
        {expired ? '00:00' : format(remaining)}
      </span>
    </div>
  )
}

function msLeft(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now())
}

function format(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
