import Link from 'next/link'
import { requireAdmin, hasRole } from '@/lib/admin/auth'
import { getManualRefundTrackerData } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { formatDateShort } from '@/lib/time/zone'
import { formatPaise } from '@/lib/booking/pricing'
import {
  Cell,
  EmptyState,
  Money,
  PageHeader,
  Pill,
  Ref,
  Row,
  SectionTitle,
  Table,
} from '../_components/ui'
import { MarkRefundPaidForm } from './_components/mark-refund-paid'

export const metadata = {
  title: 'Refund Tracker · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function RefundTrackerPage() {
  const admin = await requireAdmin()
  const settings = await getSettings()
  const tz = settings.timezone
  const canAct = hasRole(admin, 'ops')

  const { pending, completed, totalOwed, totalPaid } = await getManualRefundTrackerData()

  return (
    <>
      <PageHeader
        eyebrow="FINANCE"
        title="Refund Tracker"
        meta="Manual refund log — mark each refund paid once you confirm it in your payment gateway."
      />

      {/* Summary bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-rose/20 bg-rose-tint px-4 py-3">
          <p className="mb-1 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-rose-deep">
            OWED (UNPAID)
          </p>
          <p className="font-mono text-[22px] font-semibold text-ink">
            {formatPaise(totalOwed)}
          </p>
          <p className="mt-0.5 font-sans text-[11px] text-ink/50">
            {pending.length} refund{pending.length === 1 ? '' : 's'} pending
          </p>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="mb-1 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-green-700">
            CONFIRMED PAID
          </p>
          <p className="font-mono text-[22px] font-semibold text-ink">
            {formatPaise(totalPaid)}
          </p>
          <p className="mt-0.5 font-sans text-[11px] text-ink/50">
            {completed.length} refund{completed.length === 1 ? '' : 's'} done
          </p>
        </div>
      </div>

      {/* Pending refunds */}
      <SectionTitle>PENDING — ACTION REQUIRED</SectionTitle>
      {pending.length === 0 ? (
        <EmptyState title="No refunds pending" body="All recorded refunds have been marked as paid." />
      ) : (
        <div className="mb-6 flex flex-col gap-3">
          {pending.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Ref>{r.bookingReference}</Ref>
                    <Pill tone="amber">OWED</Pill>
                  </div>
                  <p className="mt-1 font-sans text-[13px] text-ink/70">
                    {r.customerName} · {r.companionName}
                  </p>
                  <p className="font-sans text-[12px] text-ink/50">
                    Cancelled {formatDateShort(new Date(r.createdAt), tz)} ·{' '}
                    {r.tierApplied ? `tier ${r.tierApplied}` : 'manual'}
                  </p>
                  {r.reason && (
                    <p className="mt-1 font-sans text-[12px] italic text-ink/60">
                      &ldquo;{r.reason}&rdquo;
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-mono text-[20px] font-semibold text-ink">
                    <Money paise={r.amountPaise} />
                  </p>
                  <p className="font-mono text-[10px] text-ink/40">
                    {r.paymentMethod ?? 'unknown method'}
                  </p>
                </div>
              </div>

              {canAct && (
                <MarkRefundPaidForm
                  refundId={r.id}
                  bookingId={r.bookingId}
                  amountPaise={r.amountPaise}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Completed refunds */}
      <SectionTitle>CONFIRMED PAID</SectionTitle>
      {completed.length === 0 ? (
        <EmptyState title="No completed refunds yet" />
      ) : (
        <Table head={['BOOKING', 'CUSTOMER', 'AMOUNT', 'METHOD', 'TIER', 'CONFIRMED', 'PROOF']}>
          {completed.map((r) => (
            <Row key={r.id}>
              <Cell>
                <Link
                  href={`/admin/bookings/${r.bookingId}`}
                  className="font-medium text-ink hover:underline"
                >
                  <Ref>{r.bookingReference}</Ref>
                </Link>
              </Cell>
              <Cell className="text-[12.5px]">{r.customerName}</Cell>
              <Cell>
                <Money paise={r.amountPaise} />
              </Cell>
              <Cell className="font-mono text-[10px] uppercase text-ink/55">
                {r.paymentMethod ?? '—'}
              </Cell>
              <Cell className="font-mono text-[10px] uppercase text-ink/55">
                {r.tierApplied ?? '—'}
              </Cell>
              <Cell className="font-mono text-[11px] text-ink/55">
                {r.settledAt ? formatDateShort(new Date(r.settledAt), tz) : '—'}
              </Cell>
              <Cell>
                {r.proofUrl ? (
                  <a
                    href={r.proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-sans text-[12px] text-blue underline hover:text-ink"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-[12px] text-ink/35">None</span>
                )}
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </>
  )
}
