import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PublicHeader } from '@/components/site/header'
import { POLICIES, POLICY_ORDER, type Policy } from '@/lib/policies'
import { GRIEVANCE_EMAIL, SUPPORT_PHONE } from '@/lib/contact'
import { cn } from '@/lib/utils'

export const revalidate = 3600

export function generateStaticParams() {
  return POLICY_ORDER.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const policy = POLICIES[slug as Policy['slug']]
  if (!policy) return { title: 'Not found' }
  return { title: policy.title, description: policy.intro }
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const policy = POLICIES[slug as Policy['slug']]
  if (!policy) notFound()

  return (
    <>
      <PublicHeader back={{ href: '/', label: 'Policies' }} />

      <nav
        aria-label="Policies"
        className="ac-scroll-x flex gap-[7px] border-b border-ink/10 bg-paper px-[18px] py-3"
      >
        {POLICY_ORDER.map((s) => (
          <Link
            key={s}
            href={`/policies/${s}`}
            aria-current={s === policy.slug ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full px-[11px] py-[7px] font-mono text-[10px] font-semibold',
              s === policy.slug
                ? 'bg-ink text-white'
                : 'border border-ink/10 bg-white text-ink/55',
            )}
          >
            {POLICIES[s].navLabel}
          </Link>
        ))}
      </nav>

      <header className="border-b border-ink/10 bg-white px-[18px] pb-4 pt-5">
        <div className="mb-2 font-mono text-[9px] font-semibold tracking-[0.12em] text-ink/45">
          VERSION {policy.version} · IN FORCE FROM {policy.inForceFrom.toUpperCase()}
        </div>
        <h1 className="mb-2 font-serif text-[27px] font-light leading-[1.18] text-ink">
          {policy.title}
        </h1>
        <p className="font-sans text-[13.5px] leading-[1.55] text-ink/65">{policy.intro}</p>
      </header>

      <div className="flex flex-col gap-[18px] bg-white px-[18px] py-[18px]">
        {policy.sections.map((section, i) => (
          <section
            key={section.heading}
            className={cn(
              section.emphasis &&
                'rounded-lg border border-rose/20 bg-rose-tint p-3.5',
            )}
          >
            <div className="mb-1.5 flex items-baseline gap-[11px]">
              <span
                className={cn(
                  'font-mono text-[10px] font-semibold',
                  section.emphasis ? 'text-rose-deep' : 'text-blue',
                )}
              >
                {i + 1}
              </span>
              <h2 className="font-sans text-[14.5px] font-semibold text-ink">
                {section.heading}
              </h2>
            </div>
            <p className="pl-[21px] font-sans text-[13.5px] leading-[1.6] text-ink/70">
              {section.body}
            </p>
          </section>
        ))}

        <footer className="flex flex-col gap-[7px] border-t border-ink/10 pt-3.5">
          <p className="font-sans text-[12.5px] leading-[1.5] text-ink/60">
            Grievance contact, under the Digital Personal Data Protection Act 2023:
          </p>
          <p className="font-mono text-[13px] font-semibold text-ink">
            {GRIEVANCE_EMAIL} · {SUPPORT_PHONE}
          </p>
          <p className="font-sans text-[11.5px] leading-[1.5] text-ink/50">
            Previous versions of this policy are kept and available on request. Bookings
            are governed by the version accepted at checkout.
          </p>
        </footer>
      </div>
    </>
  )
}
