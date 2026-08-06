import { requireRole } from '@/lib/admin/auth'
import { getAdminBooking } from '@/lib/admin/queries'
import { AuditNote, BackLink, Card, PageHeader } from '../../_components/ui'
import { NewIncidentForm } from '../_components/new-incident-form'

export const metadata = {
  title: 'Record incident · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function NewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>
}) {
  await requireRole('support')
  const sp = await searchParams

  const booking = sp.booking ? await getAdminBooking(sp.booking) : null

  return (
    <>
      <BackLink href={booking ? `/admin/bookings/${booking.id}` : '/admin/incidents'}>
        {booking ? 'Booking' : 'Incidents'}
      </BackLink>

      <PageHeader
        eyebrow="ENFORCEMENT RECORD"
        title="Record an incident"
        meta="Every report is written into a record attached to the booking, whether or not the booking was ended."
      />

      <Card className="max-w-xl">
        <NewIncidentForm
          bookingId={booking?.id}
          bookingReference={booking?.reference}
        />
      </Card>

      <AuditNote />
    </>
  )
}
