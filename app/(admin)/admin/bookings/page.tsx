import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { listAdminBookings } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { formatDateShort, formatSlotLabel } from '@/lib/time/zone'
import type { BookingStatus } from '@/lib/supabase/types'
import {
  Cell,
  EmptyState,
  Money,
  PageHeader,
  Pill,
  Ref,
  Row,
  StatusPill,
  Table,
} from '../_components/ui'

export const metadata = {
  title: 'Bookings · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const FILTERS: { label: string; value?: BookingStatus }[] = [
  { label: 'ALL' },
  { label: 'CONFIRMED', value: 'confirmed' },
  { label: 'HELD', value: 'pending_payment' },
  { label: 'COMPLETED', value: 'completed' },
  { label: 'CANCELLED', value: 'cancelled_by_admin' },
  { label: 'ENDED EARLY', value: 'ended_early' },
]

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const settings = await getSettings()

  const status = FILTERS.find((f) => f.value === sp.status)?.value
  const rows = await listAdminBookings({ status, search: sp.q })

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Bookings"
        meta="Search by reference. Open a booking to cancel it, preview a refund, or record an incident."
      />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search reference"
          aria-label="Search by booking reference"
          className="h-9 w-56 rounded-lg border border-ink/15 bg-white px-3 font-mono text-[12.5px] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none"
        />
        {status && <input type="hidden" name="status" value={status} />}
        <button
          type="submit"
          className="h-9 rounded-lg border border-ink/15 bg-white px-3 font-sans text-[12.5px] font-semibold text-ink hover:bg-paper-warm"
        >
          Search
        </button>
        {(sp.q || status) && (
          <Link
            href="/admin/bookings"
            className="font-sans text-[12.5px] text-ink/50 hover:text-ink"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="ac-scroll-x mb-4 flex gap-1.5">
        {FILTERS.map((f) => {
          const active = f.value === status
          const href = f.value
            ? `/admin/bookings?status=${f.value}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`
            : `/admin/bookings${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ''}`
          return (
            <Link
              key={f.label}
              href={href}
              className={
                active
                  ? 'whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-white'
                  : 'whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-ink/50 hover:bg-paper-sunk'
              }
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No bookings match"
          body={sp.q ? `Nothing found for “${sp.q}”.` : 'Bookings will appear here as they are made.'}
        />
      ) : (
        <Table head={['REFERENCE', 'CUSTOMER', 'COMPANION', 'WHEN', 'AMOUNT', 'STATUS']}>
          {rows.map((b) => {
            const starts = new Date(b.startsAt)
            return (
              <Row key={b.id}>
                <Cell>
                  <Link href={`/admin/bookings/${b.id}`} className="hover:underline">
                    <Ref>{b.reference}</Ref>
                  </Link>
                </Cell>
                <Cell>{b.customerFirstName}</Cell>
                <Cell>{b.companionName}</Cell>
                <Cell className="whitespace-nowrap font-mono text-[11.5px] uppercase text-ink/70">
                  {formatDateShort(starts, settings.timezone)} ·{' '}
                  {formatSlotLabel(starts, settings.timezone)}
                </Cell>
                <Cell>
                  <Money paise={b.amountPaise} />
                </Cell>
                <Cell>
                  <div className="flex items-center gap-1.5">
                    <StatusPill status={b.status} />
                    {b.status === 'confirmed' && !b.confirmationSentAt && (
                      <Pill tone="amber">UNSENT</Pill>
                    )}
                  </div>
                </Cell>
              </Row>
            )
          })}
        </Table>
      )}
    </>
  )
}
