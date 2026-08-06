import Link from 'next/link'
import { GradientRule, Wordmark } from '@/components/brand/mark'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { AdminNav } from './_components/admin-nav'

/**
 * The operations shell. Reachable only through the ADMIN_HOST rewrite in
 * proxy.ts, and every page inside calls requireAdmin() for itself — this layout
 * decides what to render, not who may enter.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await getCurrentAdmin()

  return (
    <div className="min-h-dvh bg-paper-warm text-ink">
      <GradientRule />
      <header className="border-b border-ink/10 bg-paper">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link href="/admin">
            <Wordmark size={24} />
          </Link>
          <div className="flex items-center gap-2.5">
            {admin && (
              <span className="font-mono text-[10px] font-medium uppercase text-ink/45">
                {admin.role}
              </span>
            )}
            <span className="rounded-full border border-blue/20 bg-blue-tint px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.1em] text-blue-dark">
              ADMIN
            </span>
          </div>
        </div>
        {admin && <AdminNav />}
      </header>
      <main className="mx-auto max-w-5xl px-5 py-6 md:py-8">{children}</main>
    </div>
  )
}
