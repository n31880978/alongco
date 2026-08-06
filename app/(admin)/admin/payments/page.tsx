import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { getPaymentsSummary } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { addDays, startOfMonthIST, startOfWeekIST } from '@/lib/admin/period'
import { formatDateShort } from '@/lib/time/zone'
import {
  Cell,
  EmptyState,
  Money,
  PageHeader,
  Pill,
  Ref,
  Row,
  SectionTitle,
  Stat,
  Table,
} from '../_components/ui'

export const metadata = {
  title: 'Payments · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const settings = await getSettings()
  const tz = settings.timezone

  const monthly = sp.period === 'month'
  const now = new Date()
  const from = monthly ? startOfMonthIST(now, tz) : startOfWeekIST(now, tz)
  const to = addDays(from, monthly ? 31 : 7, tz)

  const summary = await getPaymentsSummary(from.toISOString(), to.toISOString())

  return (
    <>
      <PageHeader
        eyebrow="RECONCILIATION"
        title="Payments"
        meta={`${monthly ? 'Month' : 'Week'} from ${formatDateShort(from, tz)}`}
      />

      <div className="mb-4 flex gap-1.5">
        <PeriodLink href="/admin/payments" active={!monthly}>
          THIS WEEK
        </PeriodLink>
        <PeriodLink href="/admin/payments?period=month" active={monthly}>
          THIS MONTH
        </PeriodLink>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="CAPTURED"
          value={<Money paise={summary.capturedPaise} className="text-[26px]" />}
          detail={`${summary.bookingCount} payment${summary.bookingCount === 1 ? '' : 's'}`}
        />
        <Stat
          label="REFUNDED"
          value={<Money paise={summary.refundedPaise} className="text-[26px]" />}
          detail={`${summary.refundCount} refund${summary.refundCount === 1 ? '' : 's'}`}
        />
        <Stat
          label="NET"
          value={<Money paise={summary.netPaise} className="text-[26px]" />}
          detail="captured less refunds"
        />
        <Stat
          label="HOURS DELIVERED"
          value={summary.perCompanion.reduce((sum, c) => sum + c.hours, 0)}
          detail="completed bookings only"
        />
      </div>

      <div className="mt-6">
        <SectionTitle>HOURS DELIVERED, BY COMPANION</SectionTitle>
        {summary.perCompanion.length === 0 ? (
          <EmptyState
            title="Nothing completed in this period"
            body="Only bookings that reached completed are counted."
          />
        ) : (
          <Table head={['COMPANION', 'BOOKINGS', 'HOURS', 'CUSTOMER PAID']}>
            {summary.perCompanion.map((c) => (
              <Row key={c.companionId}>
                <Cell>
                  <Link
                    href={`/admin/companions/${c.companionId}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {c.companionName}
                  </Link>
                </Cell>
                <Cell className="font-mono text-[12.5px]">{c.completedCount}</Cell>
                <Cell className="font-mono text-[12.5px]">{c.hours}</Cell>
                <Cell>
                  <Money paise={c.grossPaise} />
                </Cell>
              </Row>
            ))}
          </Table>
        )}
        <p className="mt-3 rounded-xl border border-ink/10 bg-paper-warm px-4 py-3 text-[12.5px] leading-[1.5] text-ink/60">
          Companion payouts are settled manually outside AlongCo, so no amount owed is
          computed here. These are the hours actually delivered and what the customer paid
          for them — the figures a manual settlement is worked out from.
        </p>
      </div>

      <div className="mt-6">
        <SectionTitle>REFUNDS ISSUED</SectionTitle>
        {summary.recentRefunds.length === 0 ? (
          <EmptyState title="No refunds in this period" />
        ) : (
          <Table head={['BOOKING', 'AMOUNT', 'TIER', 'STATUS', 'WHEN']}>
            {summary.recentRefunds.map((r) => (
              <Row key={r.id}>
                <Cell>
                  <Ref>{r.bookingReference}</Ref>
                </Cell>
                <Cell>
                  <Money paise={r.amountPaise} />
                </Cell>
                <Cell className="font-mono text-[10px] uppercase tracking-[0.05em] text-ink/55">
                  {r.tierApplied ?? '—'}
                </Cell>
                <Cell>
                  <Pill
                    tone={
                      r.status === 'success'
                        ? 'green'
                        : r.status === 'failed'
                          ? 'rose'
                          : 'amber'
                    }
                  >
                    {r.status.toUpperCase()}
                  </Pill>
                </Cell>
                <Cell className="font-mono text-[11px] uppercase text-ink/55">
                  {formatDateShort(new Date(r.createdAt), tz)}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </>
  )
}

function PeriodLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-md bg-ink px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-white'
          : 'rounded-md px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-ink/50 hover:bg-paper-sunk'
      }
    >
      {children}
    </Link>
  )
}
