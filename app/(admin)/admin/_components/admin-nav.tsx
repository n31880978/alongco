'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/confirmations', label: 'Confirmations' },
  { href: '/admin/bookings', label: 'Bookings' },
  { href: '/admin/companions', label: 'Companions' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/reviews', label: 'Reviews' },
  { href: '/admin/incidents', label: 'Incidents' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/settings', label: 'Settings' },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="ac-scroll-x mx-auto flex max-w-5xl gap-1 px-5 pb-2">
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1.5 font-sans text-[12.5px] font-semibold transition-colors',
              active ? 'bg-ink text-white' : 'text-ink/55 hover:bg-paper-sunk',
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
