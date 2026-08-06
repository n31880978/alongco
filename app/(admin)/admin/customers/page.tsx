import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { listAdminCustomers } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { formatDateShort } from '@/lib/time/zone'
import {
  AuditNote,
  Cell,
  EmptyState,
  PageHeader,
  Pill,
  Row,
  Table,
} from '../_components/ui'
import { BlockControls } from './_components/block-controls'

export const metadata = {
  title: 'Customers · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams

  const [customers, settings] = await Promise.all([
    listAdminCustomers(sp.q),
    getSettings(),
  ])

  const erasures = customers.filter((c) => c.deletionRequestedAt).length

  return (
    <>
      <PageHeader
        eyebrow="DPDP"
        title="Customers"
        meta={`${customers.length} shown${erasures ? ` · ${erasures} deletion request${erasures === 1 ? '' : 's'}` : ''}`}
      />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Name or phone"
          aria-label="Search customers by name or phone"
          className="h-9 w-56 rounded-lg border border-ink/15 bg-white px-3 font-sans text-[13px] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none"
        />
        <button
          type="submit"
          className="h-9 rounded-lg border border-ink/15 bg-white px-3 font-sans text-[12.5px] font-semibold text-ink hover:bg-paper-warm"
        >
          Search
        </button>
        {sp.q && (
          <Link
            href="/admin/customers"
            className="font-sans text-[12.5px] text-ink/50 hover:text-ink"
          >
            Clear
          </Link>
        )}
      </form>

      {customers.length === 0 ? (
        <EmptyState
          title="No customers match"
          body={sp.q ? `Nothing found for “${sp.q}”.` : undefined}
        />
      ) : (
        <Table head={['NAME', 'PHONE', 'BOOKINGS', 'LAST', 'STATE', '']}>
          {customers.map((c) => (
            <Row key={c.id}>
              <Cell>{c.fullName ?? '—'}</Cell>
              <Cell className="font-mono text-[12px] text-ink/70">{c.phone}</Cell>
              <Cell className="font-mono text-[12.5px]">{c.bookingCount}</Cell>
              <Cell className="font-mono text-[11px] uppercase text-ink/55">
                {c.lastBookingAt
                  ? formatDateShort(new Date(c.lastBookingAt), settings.timezone)
                  : '—'}
              </Cell>
              <Cell>
                {c.deletionRequestedAt ? (
                  <Pill tone="amber">ERASURE</Pill>
                ) : c.isBlocked ? (
                  <Pill tone="rose">BLOCKED</Pill>
                ) : (
                  <Pill tone="neutral">OK</Pill>
                )}
              </Cell>
              <Cell>
                <BlockControls
                  id={c.id}
                  blocked={c.isBlocked}
                  reason={c.blockReason}
                />
              </Cell>
            </Row>
          ))}
        </Table>
      )}

      <p className="mt-4 rounded-xl border border-ink/10 bg-paper-warm px-4 py-3 text-[12.5px] leading-[1.5] text-ink/60">
        Erasure requests are answered within thirty days: bookings are anonymised and
        payment records are retained as the law requires. A blocked customer is refused at
        booking with a neutral message and no slot is held.
      </p>

      <AuditNote />
    </>
  )
}
