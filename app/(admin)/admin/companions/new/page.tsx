import { requireRole } from '@/lib/admin/auth'
import { listAdminAreas } from '@/lib/admin/queries'
import { AuditNote, BackLink, Card, PageHeader } from '../../_components/ui'
import { CompanionForm } from '../_components/companion-form'

export const metadata = {
  title: 'Add companion · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function NewCompanionPage() {
  await requireRole('ops')
  const areas = await listAdminAreas()

  return (
    <>
      <BackLink href="/admin/companions">Companions</BackLink>
      <PageHeader
        eyebrow="SUPPLY"
        title="Add a companion"
        meta="He starts unlisted. Add a photograph, his weekly hours and his identity record before listing him."
      />
      <Card className="max-w-xl">
        <CompanionForm areas={areas} />
      </Card>
      <AuditNote />
    </>
  )
}
