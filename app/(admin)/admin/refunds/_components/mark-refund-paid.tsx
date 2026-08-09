'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { markRefundPaid } from '../actions'
import { formatPaise } from '@/lib/booking/pricing'

type Props = {
  refundId: string
  bookingId: string
  amountPaise: number
}

export function MarkRefundPaidForm({ refundId, bookingId, amountPaise }: Props) {
  const [state, action, pending] = useActionState(markRefundPaid, {})

  return (
    <form action={action} className="space-y-3 border-t border-amber-200 pt-3">
      <input type="hidden" name="refundId" value={refundId} />
      <input type="hidden" name="bookingId" value={bookingId} />

      <div>
        <label className="mb-1 block font-mono text-[9.5px] font-semibold tracking-[0.08em] text-ink/60">
          PAYMENT REFERENCE / UTR (optional)
        </label>
        <input
          type="text"
          name="paymentReference"
          placeholder="e.g. UTR123456789 or Razorpay refund ID"
          className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-blue focus:ring-1 focus:ring-blue/20"
        />
      </div>

      <div>
        <label className="mb-1 block font-mono text-[9.5px] font-semibold tracking-[0.08em] text-ink/60">
          SCREENSHOT PROOF (optional — JPEG / PNG / WebP, max 5 MB)
        </label>
        <input
          type="file"
          name="screenshot"
          accept="image/jpeg,image/png,image/webp"
          className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-sans text-[13px] text-ink"
        />
      </div>

      <div>
        <label className="mb-1 block font-mono text-[9.5px] font-semibold tracking-[0.08em] text-ink/60">
          NOTES (optional)
        </label>
        <textarea
          name="notes"
          rows={2}
          placeholder="Any notes about this refund payout…"
          className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-sans text-[13px] text-ink outline-none focus:border-blue focus:ring-1 focus:ring-blue/20"
        />
      </div>

      {state.error && (
        <p className="rounded-md bg-rose-tint px-3 py-2 font-sans text-[13px] text-rose-deep">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-md bg-green-50 px-3 py-2 font-sans text-[13px] text-green-700">
          {state.ok}
        </p>
      )}

      <Button type="submit" disabled={pending} size="sm" className="w-full sm:w-auto">
        {pending ? 'Saving…' : `Confirm ${formatPaise(amountPaise)} refund paid`}
      </Button>
    </form>
  )
}
