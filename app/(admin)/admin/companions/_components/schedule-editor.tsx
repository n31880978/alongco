'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import {
  addAvailabilityRule,
  addBlackout,
  removeAvailabilityRule,
  removeBlackout,
  type CompanionState,
} from '../actions'

/**
 * Weekly hours and one-off blackouts.
 *
 * Availability is computed, never stored (CLAUDE.md §4) — these two are the
 * only inputs an operator sets. There is no slots table to keep in step.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function AvailabilityEditor({
  companionId,
  rules,
}: {
  companionId: string
  rules: { id: string; weekday: number; startTime: string; endTime: string }[]
}) {
  const [state, action] = useActionState<CompanionState, FormData>(addAvailabilityRule, {})

  return (
    <div>
      {rules.length === 0 ? (
        <p className="mb-3 text-[13px] text-ink/55">
          No weekly hours set, so he has no availability at all. Add at least one rule.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between border-b border-ink/[.07] py-2 last:border-0"
            >
              <span className="text-[13px] text-ink">
                {WEEKDAYS[r.weekday]}{' '}
                <span className="font-mono text-[12px] text-ink/65">
                  {r.startTime}–{r.endTime}
                </span>
              </span>
              <form action={removeAvailabilityRule}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="companionId" value={companionId} />
                <RemoveButton label="Remove weekly rule" />
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="companionId" value={companionId} />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            DAY
          </span>
          <select
            name="weekday"
            defaultValue="1"
            className="h-9 rounded-lg border border-ink/15 bg-white px-2 font-sans text-[13px] text-ink"
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            FROM
          </span>
          <input
            type="time"
            name="startTime"
            defaultValue="14:00"
            required
            className="h-9 rounded-lg border border-ink/15 bg-white px-2 font-mono text-[13px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            TO
          </span>
          <input
            type="time"
            name="endTime"
            defaultValue="22:00"
            required
            className="h-9 rounded-lg border border-ink/15 bg-white px-2 font-mono text-[13px] text-ink"
          />
        </label>
        <AddButton label="Add" />
        <div className="w-full">
          <FieldError>{state.error}</FieldError>
        </div>
      </form>
    </div>
  )
}

export function BlackoutEditor({
  companionId,
  blackouts,
  formatRange,
}: {
  companionId: string
  blackouts: { id: string; startsAt: string; endsAt: string; reason: string | null }[]
  /** Pre-rendered IST labels, keyed by blackout id — the server owns timezone. */
  formatRange: Record<string, string>
}) {
  const [state, action] = useActionState<CompanionState, FormData>(addBlackout, {})

  return (
    <div>
      {blackouts.length === 0 ? (
        <p className="mb-3 text-[13px] text-ink/55">No blackouts.</p>
      ) : (
        <ul className="mb-3 flex flex-col">
          {blackouts.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 border-b border-ink/[.07] py-2 last:border-0"
            >
              <span className="text-[13px] text-ink">
                <span className="font-mono text-[12px]">{formatRange[b.id]}</span>
                {b.reason && (
                  <span className="ml-2 text-[12px] text-ink/55">{b.reason}</span>
                )}
              </span>
              <form action={removeBlackout}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="companionId" value={companionId} />
                <RemoveButton label="Remove blackout" />
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="companionId" value={companionId} />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            FROM
          </span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            className="h-9 rounded-lg border border-ink/15 bg-white px-2 font-mono text-[12.5px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            TO
          </span>
          <input
            type="datetime-local"
            name="endsAt"
            required
            className="h-9 rounded-lg border border-ink/15 bg-white px-2 font-mono text-[12.5px] text-ink"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            REASON
          </span>
          <input
            type="text"
            name="reason"
            maxLength={200}
            placeholder="Optional"
            className="h-9 min-w-[140px] rounded-lg border border-ink/15 bg-white px-2 font-sans text-[13px] text-ink placeholder:text-ink/35"
          />
        </label>
        <AddButton label="Add" />
        <div className="w-full">
          <FieldError>{state.error}</FieldError>
        </div>
      </form>
    </div>
  )
}

function AddButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

function RemoveButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      aria-label={label}
      disabled={pending}
      className="rounded-md px-2 py-1 font-sans text-[12px] text-ink/45 hover:bg-paper-sunk hover:text-rose-deep disabled:opacity-50"
    >
      Remove
    </button>
  )
}
