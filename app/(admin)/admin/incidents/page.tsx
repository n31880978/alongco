import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { listAdminIncidents } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { formatDateLong } from '@/lib/time/zone'
import { Button } from '@/components/ui/button'
import { AuditNote, Card, EmptyState, PageHeader, Pill, Ref, SectionTitle } from '../_components/ui'
import { IncidentControls } from './_components/incident-controls'

export const metadata = {
  title: 'Incidents · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const OPEN = new Set(['open', 'investigating', 'escalated'])

export default async function IncidentsPage() {
  await requireAdmin()
  const [incidents, settings] = await Promise.all([listAdminIncidents(), getSettings()])

  const open = incidents.filter((i) => OPEN.has(i.status))
  const closed = incidents.filter((i) => !OPEN.has(i.status))

  return (
    <>
      <PageHeader
        eyebrow="ENFORCEMENT RECORD"
        title="Incidents"
        meta={`${open.length} open · ${closed.length} resolved`}
        action={
          <Button asChild variant="ink" size="sm">
            <Link href="/admin/incidents/new">Record incident</Link>
          </Button>
        }
      />

      {incidents.length === 0 ? (
        <EmptyState
          title="Nothing recorded"
          body="Every booking ended early produces an incident automatically. Anything else is recorded here by hand."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {open.length > 0 && (
            <section>
              <SectionTitle>OPEN</SectionTitle>
              <div className="flex flex-col gap-3">
                {open.map((i) => (
                  <IncidentCard key={i.id} incident={i} tz={settings.timezone} editable />
                ))}
              </div>
            </section>
          )}

          {closed.length > 0 && (
            <section>
              <SectionTitle>RESOLVED</SectionTitle>
              <div className="flex flex-col gap-3">
                {closed.map((i) => (
                  <IncidentCard key={i.id} incident={i} tz={settings.timezone} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <AuditNote />
    </>
  )
}

function IncidentCard({
  incident: i,
  tz,
  editable,
}: {
  incident: Awaited<ReturnType<typeof listAdminIncidents>>[number]
  tz: string
  editable?: boolean
}) {
  return (
    <Card id={i.id} tone={OPEN.has(i.status) ? 'warning' : 'default'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[13.5px] font-semibold capitalize text-ink">
            {i.type.replace(/_/g, ' ')}
          </span>
          <Pill tone={i.status === 'resolved' ? 'green' : 'amber'}>
            {i.status.toUpperCase()}
          </Pill>
          {i.endedBooking && <Pill tone="rose">BOOKING ENDED</Pill>}
          <Pill tone="neutral">
            {i.refundIssued ? 'REFUND ISSUED' : 'NO REFUND'}
          </Pill>
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink/45">
          REPORTED BY {i.reportedBy}
        </span>
      </div>

      <p className="text-[13px] leading-[1.55] text-ink/80">{i.description}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[12px] text-ink/55">
        {i.bookingId && i.bookingReference && (
          <Link href={`/admin/bookings/${i.bookingId}`} className="text-blue hover:text-ink">
            <Ref>{i.bookingReference}</Ref>
          </Link>
        )}
        {i.companionName && <span>{i.companionName}</span>}
        {i.customerFirstName && <span>{i.customerFirstName}</span>}
        <span className="font-mono text-[10px] uppercase">
          {formatDateLong(new Date(i.createdAt), tz)}
        </span>
      </div>

      {i.actionTaken && !editable && (
        <p className="mt-2.5 border-t border-ink/[.07] pt-2.5 text-[12.5px] leading-[1.5] text-ink/65">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            ACTION TAKEN
          </span>
          <br />
          {i.actionTaken}
        </p>
      )}

      {editable && (
        <IncidentControls id={i.id} status={i.status} actionTaken={i.actionTaken} />
      )}
    </Card>
  )
}
