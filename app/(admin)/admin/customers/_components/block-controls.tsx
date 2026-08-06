'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { setCustomerBlocked, type CustomerState } from '../actions'

export function BlockControls({
  id,
  blocked,
  reason,
}: {
  id: string
  blocked: boolean
  reason: string | null
}) {
  const [state, action] = useActionState<CustomerState, FormData>(setCustomerBlocked, {})
  const [open, setOpen] = React.useState(false)

  if (blocked) {
    return (
      <form action={action} className="flex flex-col gap-1.5">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="blocked" value="false" />
        {reason && <p className="text-[12px] text-ink/55">{reason}</p>}
        <Unblock />
        <FieldError>{state.error}</FieldError>
      </form>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 font-sans text-[12px] text-ink/45 hover:bg-paper-sunk hover:text-rose-deep"
      >
        Block
      </button>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="blocked" value="true" />
      <input
        type="text"
        name="reason"
        required
        maxLength={500}
        placeholder="Why — required"
        className="h-8 w-full min-w-[160px] rounded-md border border-ink/15 bg-white px-2 font-sans text-[12px] text-ink placeholder:text-ink/35"
      />
      <div className="flex gap-1.5">
        <Block />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 font-sans text-[12px] text-ink/45 hover:bg-paper-sunk"
        >
          Cancel
        </button>
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  )
}

function Block() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending}>
      {pending ? '…' : 'Block'}
    </Button>
  )
}

function Unblock() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? '…' : 'Unblock'}
    </Button>
  )
}
