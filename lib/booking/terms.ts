/**
 * The conduct terms accepted at checkout. CLAUDE.md §3.8 and PRD §6.5.
 *
 * These are rendered in full on the checkout screen, not behind a link, and the
 * version accepted is written onto the booking. Changing the wording means
 * bumping the version here AND in settings.terms_version — old bookings stay
 * governed by the text they were shown.
 */

export type TermsClause = {
  text: string
  /** Rendered with the rose emphasis treatment in the design canvas. */
  emphasis?: boolean
}

export type TermsDocument = {
  version: string
  inForceFrom: string
  clauses: TermsClause[]
}

export const CONDUCT_TERMS: TermsDocument = {
  version: '2026-08-01',
  inForceFrom: '1 August 2026',
  clauses: [
    { text: 'You meet in a public place. Not a home, not a hotel, not a car.' },
    {
      text: 'Nothing romantic or sexual is offered or permitted, at any price.',
    },
    {
      text: 'Your companion may end the booking immediately for a breach of these terms, with no refund.',
      emphasis: true,
    },
    {
      text: 'Cancel more than 48h ahead for a full refund; 24–48h for 50%; nothing inside 24h. You will see the amount before you confirm.',
    },
  ],
}

/** The summary printed on the ticket. */
export const CONDUCT_SUMMARY =
  'Public places only. No romantic or sexual conduct is offered or permitted. ' +
  'Your companion may end this booking immediately for a breach, with no refund. ' +
  'Cancel 48h ahead for a full refund, 24–48h for 50%, none inside 24h. ' +
  'Companions are men, listed under a pseudonym.'

export const CONSENT_VERSION = '2026-08-01'

/** DPDP consent notice shown beside the checkbox on the details screen. */
export const CONSENT_NOTICE =
  'I agree to AlongCo holding my phone number, name and chosen area to arrange ' +
  'this booking, kept for 24 months and deleted on request.'
