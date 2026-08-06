'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { retryRefund, type BookingActionState } from '../../actions'

/** Re-sends a refund Cashfree refused. Idempotent on the refund reference. */
export function RetryRefundButton({ refundId }: { refundId: string }) {
  const [state, action] = useActionState<BookingActionState, FormData>(retryRefund, {})

  return (
    <form action={action}>
      <input type="hidden" name="refundId" value={refundId} />
      {state.error && (
        <p role="alert" className="mb-2 text-[12.5px] text-rose-deep">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mb-2 text-[12.5px] text-green">
          {state.ok}
        </p>
      )}
      <Submit />
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Retrying…' : 'Retry this refund'}
    </Button>
  )
}
