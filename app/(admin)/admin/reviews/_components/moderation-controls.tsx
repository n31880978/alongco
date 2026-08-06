'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { moderateReview, type ReviewState } from '../actions'

export function ModerationControls({
  id,
  blocked,
  note,
}: {
  id: string
  /** Tied to an open incident — publishing is refused server-side too. */
  blocked: boolean
  note: string | null
}) {
  const [state, action] = useActionState<ReviewState, FormData>(moderateReview, {})

  return (
    <form action={action} className="mt-3 border-t border-ink/[.07] pt-3">
      <input type="hidden" name="id" value={id} />

      <input
        type="text"
        name="note"
        maxLength={500}
        defaultValue={note ?? ''}
        placeholder="Moderation note — internal only"
        className="mb-2 h-9 w-full rounded-lg border border-ink/15 bg-white px-2.5 font-sans text-[12.5px] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none"
      />

      <div className="flex flex-wrap gap-2">
        <DecisionButton
          decision="publish"
          variant="ink"
          disabled={blocked}
          label="Publish"
        />
        <DecisionButton decision="hold" variant="outline" label="Hold" />
        <DecisionButton decision="reject" variant="outline" label="Reject" />
      </div>

      {blocked && (
        <p className="mt-2 text-[12px] leading-[1.45] text-amber">
          Held while the incident is open. Reviews tied to an open incident are never
          published automatically.
        </p>
      )}

      <FieldError>{state.error}</FieldError>
      {state.ok && (
        <p role="status" className="mt-1.5 text-[12.5px] font-semibold text-green">
          {state.ok}
        </p>
      )}
    </form>
  )
}

function DecisionButton({
  decision,
  label,
  variant,
  disabled,
}: {
  decision: string
  label: string
  variant: 'ink' | 'outline'
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      variant={variant}
      size="sm"
      disabled={pending || disabled}
    >
      {label}
    </Button>
  )
}
