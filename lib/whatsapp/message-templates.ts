/**
 * WhatsApp confirmation copy. CLAUDE.md §2, PRD §6.8.
 *
 * Plain strings, composed here and copied by hand out of the admin queue into
 * the WhatsApp Business app. There is no API integration in v1 (CLAUDE.md §9 —
 * do not add a chat feature), so nothing in this file sends anything. It exists
 * so the wording is versioned and identical every time, instead of being retyped
 * by whoever is on shift.
 *
 * The customer template carries her first name only. The companion template
 * carries her first name only as well — never her surname and never her number
 * (PRD §6.8: the companion is contacted separately with the customer's first
 * name). His real name appears in neither (CLAUDE.md §3.6).
 */

export const TEMPLATE_VERSION = 'v3'

export type ConfirmationFacts = {
  reference: string
  customerFirstName: string
  companionDisplayName: string
  /** 'Saturday 8 August' — already rendered in IST by the caller. */
  dayLabel: string
  /** '4:00 PM' */
  startLabel: string
  /** '5:00 PM' */
  endLabel: string
  areaName: string
  /** 'one hour', 'two hours' */
  durationLabel: string
  customerNotes?: string | null
  supportPhone: string
}

/** Sent to the customer. She is asked to reply, which opens the thread. */
export function customerConfirmation(f: ConfirmationFacts): string {
  return [
    `Hello ${f.customerFirstName} — this is AlongCo confirming your booking ${f.reference}.`,
    '',
    `${f.companionDisplayName} will meet you on ${f.dayLabel} at ${f.startLabel} at ${f.areaName}, for ${f.durationLabel}. He has your first name and your note.`,
    '',
    'Please reply to this message so we know it reached you, and tell us the exact spot you would like to meet.',
    '',
    `If anything feels wrong before or during the booking, call ${f.supportPhone} and we will step in.`,
  ].join('\n')
}

/** Sent to the companion, separately. Her first name and note, nothing more. */
export function companionConfirmation(f: ConfirmationFacts): string {
  const lines = [
    `${f.companionDisplayName} — booking ${f.reference} is confirmed and paid.`,
    '',
    `${f.dayLabel}, ${f.startLabel}–${f.endLabel} at ${f.areaName}. ${f.durationLabel}, no extension.`,
    `You are meeting ${f.customerFirstName}.`,
  ]

  if (f.customerNotes?.trim()) {
    lines.push('', `Her note: "${f.customerNotes.trim()}"`)
  }

  lines.push(
    '',
    'Public place only. If the conduct terms are broken you may end the booking immediately, with no refund due — call us the same day either way and we will record it.',
    `Reply here to confirm you have this. Support: ${f.supportPhone}`,
  )

  return lines.join('\n')
}

/** 60 -> 'one hour'. Falls back to digits past the durations we sell. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six']
export function durationLabel(minutes: number): string {
  const hours = minutes / 60
  if (!Number.isInteger(hours)) return `${minutes} minutes`
  const word = WORDS[hours] ?? String(hours)
  return `${word} ${hours === 1 ? 'hour' : 'hours'}`
}

/**
 * wa.me wants a bare international number: digits only, no '+', no spaces.
 * Indian numbers are stored as +91XXXXXXXXXX.
 */
export function waMeLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits}`
}
