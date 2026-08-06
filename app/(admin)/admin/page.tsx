import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { getDashboard, listOrphanedPayments } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { addDays, startOfDayIST, startOfWeekIST } from '@/lib/admin/period'
import { formatDateLong, formatSlotLabel } from '@/lib/time/zone'
import { Card, Money, PageHeader, Pill, Ref, Stat, StatusPill, Table, Cell, Row, EmptyState } from './_components/ui'

export const metadata = {
  title: 'Dashboard · AlongCo Admin',
  robots: { index: false, follow: false },
}

// Operations data; never cache it.
export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  await requireAdmin()
  const settings = await getSettings()

  const now = new Date()
  const dayStart = startOfDayIST(now, settings.timezone)
  const dayEnd = addDays(dayStart, 1, settings.timezone)
  const weekStart = startOfWeekIST(now, settings.timezone)

  const [data, orphaned] = await Promise.all([
    getDashboard(
      dayStart.toISOString(),
      dayEnd.toISOString(),
      weekStart.toISOString(),
      settings.confirmationSlaMinutes,
    ),
    listOrphanedPayments(),
  ])

  return (
    <>
      <PageHeader
        eyebrow="ALONGCO OPERATIONS"
        title={formatDateLong(now, settings.timezone)}
        meta={
          <>
            Service hours {settings.serviceHours.start}–{settings.serviceHours.end} IST ·
            all times local
          </>
        }
        action={
          data.unsentCount > 0 ? (
            <Link
              href="/admin/confirmations"
              className="rounded-full border border-amber/30 bg-amber-tint px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-amber"
            >
              {data.unsentCount} CONFIRMATION{data.unsentCount === 1 ? '' : 'S'} UNSENT
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="BOOKINGS TODAY"
          value={data.bookingsToday}
          detail={`${data.confirmedToday} confirmed · ${data.heldToday} held`}
        />
        <Stat
          label="UNSENT CONFIRMATIONS"
          value={data.unsentCount}
          detail={
            data.overdueCount > 0
              ? `${data.overdueCount} overdue past ${settings.confirmationSlaMinutes} min`
              : 'all inside the window'
          }
          tone={data.overdueCount > 0 ? 'danger' : data.unsentCount > 0 ? 'warning' : 'default'}
        />
        <Stat
          label="OPEN INCIDENTS"
          value={data.openIncidents}
          detail={data.openIncidents > 0 ? 'needs a resolution' : 'none open'}
          tone={data.openIncidents > 0 ? 'warning' : 'default'}
        />
        <Stat
          label="REVENUE THIS WEEK"
          value={<Money paise={data.weekRevenuePaise} className="text-[26px]" />}
          detail={`${data.weekHours} hours booked · ${data.weekRefunds} refund${data.weekRefunds === 1 ? '' : 's'}`}
        />
      </div>

      {(orphaned.length > 0 ||
        data.overdueCount > 0 ||
        data.openIncidents > 0 ||
        data.pendingReviews > 0) && (
        <div className="mt-6">
          <h2 className="mb-3 font-mono text-[10px] font-semibold tracking-[0.13em] text-rose-deep">
            NEEDS YOU NOW
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {/* Should always be empty. It is not empty when a payment landed
                after the hold expired and the slot had been resold — she paid
                for a booking she does not have. */}
            {orphaned.map((p) => (
              <Card key={p.bookingId} tone="danger">
                <p className="text-[13px] font-semibold text-rose-deep">
                  Money captured, no booking
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-ink/70">
                  <Ref>{p.reference}</Ref> — <Money paise={p.amountPaise} /> captured
                  against a booking that is {p.bookingStatus.replace(/_/g, ' ')}. A full
                  refund is owed.
                </p>
                <Link
                  href={`/admin/bookings/${p.bookingId}`}
                  className="mt-2 inline-block text-[12.5px] font-semibold text-blue"
                >
                  Refund her →
                </Link>
              </Card>
            ))}
            {data.overdueCount > 0 && (
              <Card tone="danger">
                <p className="text-[13px] font-semibold text-ink">
                  {data.overdueCount} confirmation{data.overdueCount === 1 ? '' : 's'} past{' '}
                  {settings.confirmationSlaMinutes} minutes
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-ink/65">
                  She has paid and heard nothing since the ticket.
                </p>
                <Link
                  href="/admin/confirmations"
                  className="mt-2 inline-block text-[12.5px] font-semibold text-blue"
                >
                  Open queue →
                </Link>
              </Card>
            )}
            {data.openIncidents > 0 && (
              <Card tone="warning">
                <p className="text-[13px] font-semibold text-ink">
                  {data.openIncidents} open incident{data.openIncidents === 1 ? '' : 's'}
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-ink/65">
                  Every early termination needs a written record.
                </p>
                <Link
                  href="/admin/incidents"
                  className="mt-2 inline-block text-[12.5px] font-semibold text-blue"
                >
                  Open incidents →
                </Link>
              </Card>
            )}
            {data.pendingReviews > 0 && (
              <Card>
                <p className="text-[13px] font-semibold text-ink">
                  {data.pendingReviews} review{data.pendingReviews === 1 ? '' : 's'} waiting
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-ink/65">
                  Nothing publishes without moderation.
                </p>
                <Link
                  href="/admin/reviews"
                  className="mt-2 inline-block text-[12.5px] font-semibold text-blue"
                >
                  Moderate →
                </Link>
              </Card>
            )}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-3 font-mono text-[10px] font-semibold tracking-[0.13em] text-ink/45">
          TODAY&rsquo;S SCHEDULE
        </h2>
        {data.todaysSchedule.length === 0 ? (
          <EmptyState
            title="Nothing booked today"
            body="Bookings for the next seven days appear under Bookings."
          />
        ) : (
          <Table head={['TIME', 'COMPANION', 'CUSTOMER', 'AREA', 'STATUS']}>
            {data.todaysSchedule.map((b) => (
              <Row key={b.id}>
                <Cell className="whitespace-nowrap font-mono text-[12.5px]">
                  {formatSlotLabel(new Date(b.startsAt), settings.timezone)}
                </Cell>
                <Cell>{b.companionName}</Cell>
                <Cell>
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {b.customerFirstName}
                  </Link>
                  <span className="ml-2">
                    <Ref>{b.reference}</Ref>
                  </span>
                </Cell>
                <Cell className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink/55">
                  {b.areaName}
                </Cell>
                <Cell>
                  {b.isRunning ? (
                    <Pill tone="blue">RUNNING</Pill>
                  ) : b.status === 'confirmed' && !b.confirmationSentAt ? (
                    <Pill tone="amber">UNSENT</Pill>
                  ) : (
                    <StatusPill status={b.status} />
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </>
  )
}
