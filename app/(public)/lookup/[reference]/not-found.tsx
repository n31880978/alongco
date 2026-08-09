import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center justify-center px-5 py-16 text-center">
      <h1 className="mb-2 font-serif text-[32px] font-light text-ink">Not found</h1>
      <p className="mb-6 font-sans text-[15px] leading-[1.6] text-ink/60">
        We couldn't find a booking with that reference. Double-check the code on your
        ticket and try again, or browse to book a new slot.
      </p>

      <div className="flex flex-col gap-2">
        <Button asChild size="lg" className="w-full">
          <Link href="/">Back to home</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/companions">Browse companions</Link>
        </Button>
      </div>
    </div>
  )
}
