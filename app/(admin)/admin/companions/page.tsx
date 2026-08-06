import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { listAdminCompanions } from '@/lib/admin/queries'
import { formatPaise } from '@/lib/booking/pricing'
import { Button } from '@/components/ui/button'
import {
  AuditNote,
  Cell,
  EmptyState,
  PageHeader,
  Pill,
  Row,
  Table,
} from '../_components/ui'

export const metadata = {
  title: 'Companions · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function CompanionsPage() {
  await requireAdmin()
  const companions = await listAdminCompanions()

  const listed = companions.filter((c) => c.isActive).length
  const paused = companions.filter((c) => c.isActive && !c.isAccepting).length

  return (
    <>
      <PageHeader
        eyebrow="SUPPLY"
        title="Companions"
        meta={`${listed} listed · ${paused} paused · ${companions.length - listed} unlisted`}
        action={
          <Button asChild variant="ink" size="sm">
            <Link href="/admin/companions/new">Add companion</Link>
          </Button>
        }
      />

      {companions.length === 0 ? (
        <EmptyState
          title="No companions yet"
          body="Add one, upload a photograph, set his weekly hours, then list him."
        />
      ) : (
        <Table head={['PSEUDONYM', 'RATE', 'AREAS', 'UPCOMING', 'IDENTITY', 'STATE']}>
          {companions.map((c) => (
            <Row key={c.id}>
              <Cell>
                <Link
                  href={`/admin/companions/${c.id}`}
                  className="font-medium text-ink hover:underline"
                >
                  {c.displayName}
                </Link>
                <div className="font-mono text-[10px] text-ink/40">/{c.slug}</div>
              </Cell>
              <Cell className="font-mono text-[12.5px] font-semibold">
                {formatPaise(c.hourlyRatePaise)}
              </Cell>
              <Cell className="font-mono text-[10px] uppercase tracking-[0.05em] text-ink/55">
                {c.areas.map((a) => a.name).join(', ') || '—'}
              </Cell>
              <Cell className="font-mono text-[12px] text-ink/70">{c.upcomingCount}</Cell>
              <Cell>
                {c.hasIdentity ? (
                  <Pill tone="neutral">ON FILE</Pill>
                ) : (
                  <Pill tone="amber">MISSING</Pill>
                )}
              </Cell>
              <Cell>
                {!c.isActive ? (
                  <Pill tone="neutral">UNLISTED</Pill>
                ) : c.isAccepting ? (
                  <Pill tone="green">ACTIVE</Pill>
                ) : (
                  <Pill tone="amber">PAUSED</Pill>
                )}
              </Cell>
            </Row>
          ))}
        </Table>
      )}

      <p className="mt-4 rounded-xl border border-ink/10 bg-paper-warm px-4 py-3 text-[12.5px] leading-[1.5] text-ink/60">
        Legal name, ID document and vetting notes sit behind a restricted panel on each
        companion and never enter a customer-facing query.
      </p>

      <AuditNote />
    </>
  )
}
