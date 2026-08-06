import { redirect } from 'next/navigation'

/**
 * Short alias for the ticket. This is what the QR encodes, so it has to stay
 * short enough to scan reliably on a printed stub and stable forever.
 */
export default async function ShortTicketAlias({
  params,
}: {
  params: Promise<{ reference: string }>
}) {
  const { reference } = await params
  redirect(`/ticket/${reference.toUpperCase()}`)
}
