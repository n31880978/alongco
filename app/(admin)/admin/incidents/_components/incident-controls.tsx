'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { updateIncident, type IncidentState } from '../actions'

/** Move an incident along, or close it with what was actually done. */
export function IncidentControls({
  id,
  status,
  actionTaken,
}: {
  id: string
  status: string
  actionTaken: string | null
}) {
  const [state, action] = useActionState<IncidentState, FormData>(updateIncident, {})

  return (
    <form action={action} className="mt-3 border-t border-ink/[.07] pt-3">
      <input type="hidden" name="id" value={id} />

      <label
        htmlFor={`action-${id}`}
        className="mb-1.5 block font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45"
      >
        WHAT WAS DONE
      </label>
      <textarea
        id={`action-${id}`}
        name="actionTaken"
        rows={2}
        maxLength={4000}
        defaultValue={actionTaken ?? ''}
        placeholder="Required before this can be resolved."
        className="mb-2 w-full rounded-lg border border-ink/15 bg-white px-2.5 py-2 font-sans text-[13px] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          name="status"
          defaultValue={status}
          className="h-9 rounded-lg border border-ink/15 bg-white px-2 font-sans text-[13px] text-ink"
        >
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="escalated">Escalated</option>
          <option value="resolved">Resolved</option>
        </select>
        <Submit />
      </div>

      <FieldError>{state.error}</FieldError>
      {state.ok && (
        <p role="status" className="mt-1.5 text-[12.5px] font-semibold text-green">
          {state.ok}
        </p>
      )}
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Update'}
    </Button>
  )
}
