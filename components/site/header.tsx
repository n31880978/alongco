import Link from 'next/link'
import { Wordmark } from '@/components/brand/mark'

export function PublicHeader({
  back,
  subtitle,
}: {
  back?: { href: string; label: string; subtitle?: string }
  subtitle?: string
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-ink/10 bg-white px-[18px] py-3">
      {back ? (
        <Link href={back.href} className="flex min-w-0 items-center gap-3 text-ink">
          <span
            aria-hidden
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-ink/15 text-[16px] leading-none"
          >
            ‹
          </span>
          <span className="min-w-0">
            <span className="block truncate font-sans text-[14px] font-semibold">
              {back.label}
            </span>
            {back.subtitle ? (
              <span className="block truncate font-mono text-[10px] font-medium uppercase text-ink/45">
                {back.subtitle}
              </span>
            ) : null}
          </span>
        </Link>
      ) : (
        <Link href="/" aria-label="AlongCo home">
          <Wordmark size={24} />
        </Link>
      )}
      <span className="shrink-0 rounded-full border border-blue/15 bg-blue-tint px-[9px] py-[5px] font-mono text-[10px] font-semibold text-blue-dark">
        {subtitle ?? 'BANGALORE'}
      </span>
    </header>
  )
}
