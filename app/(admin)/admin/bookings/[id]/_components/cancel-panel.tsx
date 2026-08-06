'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cancelBooking, type BookingActionState } from '../../actions'

/**
 * Cancellation with the refund stated before it happens. PRD §6.9.
 *
 * Every amount shown here was computed on the server by ac_refund_quote and
 * passed in — this component picks between pre-computed options and never does
 * arithmetic of its own. The figure the operator reads is therefore the figure
 * that will be sent, not an estimate of it.
 */

export type TriggerOption = {
  value: string
  label: string
  description: string
  amountPaise: number
  percent: number
  tierCode: string
  /** Conduct breach cannot proceed without a written incident (T17). */
  requiresIncident: boolean
  /** Whether the slot returns to availability. */
  freesSlot: boolean
}

export function CancelPanel({
  bookingId,
  options,
  amountPaidLabel,
  startsInLabel,
  formatted,
}: {
  bookingId: string
  options: TriggerOption[]
  amountPaidLabel: string
  startsInLabel: string
  /** Pre-formatted rupee strings, keyed by trigger value. */
  formatted: Record<string, string>
}) {
  const [state, action] = useActionState<BookingActionState, FormData>(cancelBooking, {})
  const [trigger, setTrigger] = React.useState(options[0]?.value ?? 'admin_cancel')
  const [confirming, setConfirming] = React.useState(false)

  const selected = options.find((o) => o.value === trigger) ?? options[0]

  return (
    <form action={action} className="rounded-xl border border-rose-deep/25 bg-rose-tint p-4 md:p-5">
      <input type="hidden" name="bookingId" value={bookingId} />

      <h2 className="mb-1 font-mono text-[10px] font-semibold tracking-[0.13em] text-rose-deep">
        CANCEL — REFUND PREVIEW
      </h2>
      <p className="mb-3 text-[12.5px] text-ink/60">
        Starts in {startsInLabel} · {amountPaidLabel} captured
      </p>

      <fieldset className="mb-3">
        <legend className="sr-only">Why is this booking being cancelled?</legend>
        <div className="flex flex-col gap-1.5">
          {options.map((o) => (
            <label
              key={o.value}
              className={
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ' +
                (trigger === o.value
                  ? 'border-ink/25 bg-white'
                  : 'border-ink/10 bg-white/50 hover:bg-white')
              }
            >
              <input
                type="radio"
                name="trigger"
                value={o.value}
                checked={trigger === o.value}
                onChange={() => {
                  setTrigger(o.value)
                  setConfirming(false)
                }}
                className="mt-0.5 h-4 w-4 accent-[#2E63E8]"
              />
              <span className="flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-semibold text-ink">{o.label}</span>
                  <span className="whitespace-nowrap font-mono text-[12.5px] font-semibold text-ink">
                    {formatted[o.value]}
                  </span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-[1.45] text-ink/60">
                  {o.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {selected?.requiresIncident && (
        <div className="mb-3 rounded-lg border border-amber/30 bg-amber-tint p-3">
          <label
            htmlFor="incidentDescription"
            className="mb-1.5 block font-mono text-[9.5px] font-semibold tracking-[0.1em] text-amber"
          >
            INCIDENT RECORD — REQUIRED
          </label>
          <p className="mb-2 text-[12px] leading-[1.45] text-ink/65">
            A booking ended for a conduct breach must have a written record. The database
            refuses the cancellation without one.
          </p>
          <select
            name="incidentType"
            defaultValue="conduct_violation"
            className="mb-2 h-9 w-full rounded-lg border border-ink/15 bg-white px-2.5 font-sans text-[13px] text-ink"
          >
            <option value="conduct_violation">Conduct violation</option>
            <option value="safety_concern">Safety concern</option>
            <option value="other">Other</option>
          </select>
          <textarea
            id="incidentDescription"
            name="incidentDescription"
            rows={3}
            required
            placeholder="What happened, who reported it, and what was done."
            className="w-full rounded-lg border border-ink/15 bg-white px-2.5 py-2 font-sans text-[13px] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none"
          />
        </div>
      )}

      <label htmlFor="reason" className="mb-1.5 block font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
        REASON — GOES ON THE AUDIT LOG
      </label>
      <input
        id="reason"
        name="reason"
        type="text"
        maxLength={500}
        placeholder="Why this is being cancelled"
        className="mb-3 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 font-sans text-[13px] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none"
      />

      {state.error && (
        <p role="alert" className="mb-3 rounded-lg border border-rose-deep/30 bg-white px-3 py-2 text-[12.5px] text-rose-deep">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mb-3 rounded-lg border border-green/30 bg-green-tint px-3 py-2 text-[12.5px] text-green">
          {state.ok}
        </p>
      )}

      {!confirming ? (
        <Button
          type="button"
          variant="danger"
          size="md"
          onClick={() => setConfirming(true)}
          className="w-full"
        >
          Cancel and refund {formatted[trigger]}
        </Button>
      ) : (
        <div className="rounded-lg border border-rose-deep/30 bg-white p-3">
          <p className="mb-2.5 text-[13px] leading-[1.5] text-ink">
            This cancels the booking and sends{' '}
            <strong className="font-mono">{formatted[trigger]}</strong> back to her original
            payment method under <strong>{selected?.tierCode}</strong>.
            {selected?.freesSlot
              ? ' The slot returns to availability.'
              : ' The slot stays consumed and will not be resold.'}{' '}
            It cannot be undone.
          </p>
          <div className="flex gap-2">
            <SubmitButton />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Go back
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending}>
      {pending ? 'Sending…' : 'Yes, cancel it'}
    </Button>
  )
}
