'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHelp, FieldLabel } from '@/components/ui/field'
import { createIncident, type IncidentState } from '../actions'

export function NewIncidentForm({
  bookingId,
  bookingReference,
}: {
  bookingId?: string
  bookingReference?: string
}) {
  const [state, action] = useActionState<IncidentState, FormData>(createIncident, {})

  return (
    <form action={action} className="flex flex-col gap-3.5">
      {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}

      {bookingReference && (
        <p className="rounded-lg border border-ink/10 bg-paper-sunk px-3 py-2 text-[13px] text-ink">
          Against booking{' '}
          <span className="font-mono font-semibold">{bookingReference}</span>
        </p>
      )}

      <div>
        <FieldLabel htmlFor="type">What kind of incident</FieldLabel>
        <select
          id="type"
          name="type"
          defaultValue="conduct_violation"
          className="h-12 w-full rounded-lg border border-ink/15 bg-white px-3 font-sans text-[14.5px] text-ink"
        >
          <option value="conduct_violation">Conduct violation</option>
          <option value="safety_concern">Safety concern</option>
          <option value="no_show">No-show</option>
          <option value="payment_dispute">Payment dispute</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <FieldLabel htmlFor="reportedBy">Who reported it</FieldLabel>
        <select
          id="reportedBy"
          name="reportedBy"
          defaultValue="customer"
          className="h-12 w-full rounded-lg border border-ink/15 bg-white px-3 font-sans text-[14.5px] text-ink"
        >
          <option value="customer">The customer</option>
          <option value="companion">The companion</option>
          <option value="admin">Us</option>
        </select>
      </div>

      <div>
        <FieldLabel htmlFor="description">What happened</FieldLabel>
        <textarea
          id="description"
          name="description"
          rows={5}
          required
          minLength={10}
          maxLength={4000}
          placeholder="Times, what was said or done, who was spoken to."
          className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 font-sans text-[13.5px] leading-[1.45] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none"
        />
        <FieldHelp>
          Written as a record for a dispute months later, not as a note to yourself.
        </FieldHelp>
      </div>

      <label className="flex items-start gap-2.5">
        <input type="checkbox" name="endedBooking" className="mt-0.5 h-4 w-4 accent-[#2E63E8]" />
        <span className="text-[13px] leading-[1.45] text-ink">
          The booking was terminated over this
        </span>
      </label>

      <label className="flex items-start gap-2.5">
        <input type="checkbox" name="refundIssued" className="mt-0.5 h-4 w-4 accent-[#2E63E8]" />
        <span className="text-[13px] leading-[1.45] text-ink">
          A refund was issued
          <span className="block text-[12px] text-ink/55">
            Tick only if the refund actually went out. Cancelling from the booking page
            records this by itself.
          </span>
        </span>
      </label>

      <FieldError>{state.error}</FieldError>
      <Submit />
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ink" size="md" disabled={pending} className="self-start">
      {pending ? 'Recording…' : 'Record incident'}
    </Button>
  )
}
