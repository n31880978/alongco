'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

/** Area chips. Links rather than state, so a filtered list is shareable. */
export function AreaFilter({
  areas,
  active,
}: {
  areas: string[]
  active: string | null
}) {
  const pathname = usePathname()
  const search = useSearchParams()

  const href = (area: string | null) => {
    const next = new URLSearchParams(search.toString())
    if (area) next.set('area', area)
    else next.delete('area')
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return (
    <nav
      aria-label="Filter by area"
      className="ac-scroll-x flex gap-[7px] border-b border-ink/10 bg-paper px-[18px] py-3"
    >
      <Chip href={href(null)} active={!active}>
        ALL AREAS
      </Chip>
      {areas.map((a) => (
        <Chip key={a} href={href(a)} active={active === a}>
          {a.toUpperCase()}
        </Chip>
      ))}
    </nav>
  )
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'whitespace-nowrap rounded-full px-[11px] py-[7px] font-mono text-[10.5px] font-semibold',
        active
          ? 'bg-ink text-white'
          : 'border border-ink/10 bg-white text-ink/55 hover:border-ink/20',
      )}
    >
      {children}
    </Link>
  )
}
