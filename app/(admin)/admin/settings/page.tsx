import { requireAdmin, hasRole } from '@/lib/admin/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getSettings } from '@/lib/settings'
import { formatDateLong, formatSlotLabel } from '@/lib/time/zone'
import {
  Card,
  Cell,
  DefinitionRow,
  EmptyState,
  PageHeader,
  Pill,
  Row,
  SectionTitle,
  Table,
} from '../_components/ui'

export const metadata = {
  title: 'Settings · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Booking rules, refund tiers and the audit log.
 *
 * Read-only on purpose. Every value shown is live from the `settings` table
 * (CLAUDE.md §3.10) — changing a refund tier or the hold duration reprices real
 * money and belongs in a migration that can be reviewed and rolled back, not
 * behind a text box on a web page.
 */
export default async function SettingsPage() {
  const admin = await requireAdmin()
  const settings = await getSettings()
  const service = createServiceClient()

  const [{ data: admins }, { data: audit }, { data: areas }] = await Promise.all([
    service.from('admin_users').select('id, email, role, is_active').order('email'),
    service
      .from('admin_audit_log')
      .select('id, action, entity_type, entity_id, created_at, admin_users ( email )')
      .order('created_at', { ascending: false })
      .limit(40),
    service.from('areas').select('name, is_active').order('sort_order'),
  ])

  const tz = settings.timezone

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Settings"
        meta="These come from the settings table, not from the code. Changing one changes the running business."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>BOOKING RULES</SectionTitle>
          <DefinitionRow label="MINIMUM DURATION">
            <span className="font-mono">{settings.minDurationMinutes} MIN</span>
          </DefinitionRow>
          <DefinitionRow label="BUFFER AFTER A BOOKING">
            <span className="font-mono">{settings.bufferMinutes} MIN</span>
          </DefinitionRow>
          <DefinitionRow label="PAYMENT HOLD">
            <span className="font-mono">{settings.holdMinutes} MIN</span>
          </DefinitionRow>
          <DefinitionRow label="BOOKING WINDOW">
            <span className="font-mono">{settings.bookingWindowDays} DAYS</span>
          </DefinitionRow>
          <DefinitionRow label="SERVICE HOURS">
            <span className="font-mono">
              {settings.serviceHours.start}–{settings.serviceHours.end}
            </span>
          </DefinitionRow>
          <DefinitionRow label="CONFIRMATION SLA">
            <span className="font-mono">{settings.confirmationSlaMinutes} MIN</span>
          </DefinitionRow>
          <DefinitionRow label="TERMS VERSION">
            <span className="font-mono">{settings.termsVersion}</span>
          </DefinitionRow>
        </Card>

        <Card>
          <SectionTitle>REFUND TIERS</SectionTitle>
          {settings.refundTiers
            .slice()
            .sort((a, b) => b.min_hours_before - a.min_hours_before)
            .map((t) => (
              <DefinitionRow
                key={t.code}
                label={
                  t.min_hours_before === 0
                    ? 'UNDER 24 HOURS'
                    : `${t.min_hours_before} HOURS OR MORE BEFORE`
                }
              >
                <span className="font-mono font-semibold">{t.percent}%</span>
                <span className="ml-2 font-mono text-[10px] text-ink/45">{t.code}</span>
              </DefinitionRow>
            ))}

          <div className="mt-4">
            <SectionTitle>DURATION DISCOUNTS</SectionTitle>
            {settings.durationDiscounts
              .slice()
              .sort((a, b) => a.min_minutes - b.min_minutes)
              .map((d) => (
                <DefinitionRow
                  key={d.min_minutes}
                  label={`${d.min_minutes / 60} HOUR${d.min_minutes > 60 ? 'S' : ''} OR MORE`}
                >
                  <span className="font-mono font-semibold">
                    {d.percent === 0 ? '—' : `−${d.percent}%`}
                  </span>
                </DefinitionRow>
              ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>AREAS</SectionTitle>
          {((areas as { name: string; is_active: boolean }[]) ?? []).map((a) => (
            <DefinitionRow key={a.name} label={a.name.toUpperCase()}>
              {a.is_active ? <Pill tone="green">ACTIVE</Pill> : <Pill>OFF</Pill>}
            </DefinitionRow>
          ))}
        </Card>

        <Card>
          <SectionTitle>ADMIN USERS</SectionTitle>
          {((admins as { id: string; email: string; role: string; is_active: boolean }[]) ?? []).map(
            (a) => (
              <DefinitionRow key={a.id} label={a.role.toUpperCase()}>
                {/* Admin emails, not customer data — safe to show to an admin. */}
                <span className="font-mono text-[12px]">{a.email}</span>
                {!a.is_active && <span className="ml-2 text-[11px] text-ink/45">disabled</span>}
              </DefinitionRow>
            ),
          )}
          {hasRole(admin, 'owner') && (
            <p className="mt-2.5 text-[12px] leading-[1.5] text-ink/55">
              Admin users are added directly in Supabase against a real auth user, so a
              compromised admin session cannot mint another admin.
            </p>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle>AUDIT LOG · LAST 40</SectionTitle>
        {!audit || (audit as unknown[]).length === 0 ? (
          <EmptyState title="Nothing logged yet" />
        ) : (
          <Table head={['WHO', 'ACTION', 'ENTITY', 'WHEN']}>
            {(audit as any[]).map((e) => (
              <Row key={e.id}>
                <Cell className="font-mono text-[11.5px] text-ink/70">
                  {e.admin_users?.email ?? '—'}
                </Cell>
                <Cell className="font-mono text-[11.5px] font-semibold uppercase tracking-[0.04em]">
                  {e.action}
                </Cell>
                <Cell className="font-mono text-[10px] uppercase text-ink/50">
                  {e.entity_type}
                </Cell>
                <Cell className="whitespace-nowrap font-mono text-[11px] text-ink/55">
                  {formatDateLong(new Date(e.created_at), tz)}{' '}
                  {formatSlotLabel(new Date(e.created_at), tz)}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </>
  )
}
