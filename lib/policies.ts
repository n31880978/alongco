import { GRIEVANCE_EMAIL, SUPPORT_PHONE } from '@/lib/contact'

/**
 * The four policy documents. PRD §6.12.
 *
 * These are not marketing copy. A published refund policy is a Cashfree
 * onboarding requirement, the privacy notice is a DPDP Act 2023 obligation, and
 * the conduct policy is the thing accepted at checkout — so it must match
 * lib/booking/terms.ts word for word in substance.
 *
 * Plain language, short sentences, readable on a phone.
 */

export type PolicySection = {
  heading: string
  body: string
  /** Rendered with the rose emphasis panel. */
  emphasis?: boolean
}

export type Policy = {
  slug: 'conduct' | 'refunds' | 'privacy' | 'terms'
  navLabel: string
  title: string
  version: string
  inForceFrom: string
  intro: string
  sections: PolicySection[]
}

export const POLICY_ORDER: Policy['slug'][] = ['conduct', 'refunds', 'privacy', 'terms']

export const POLICIES: Record<Policy['slug'], Policy> = {
  conduct: {
    slug: 'conduct',
    navLabel: 'CONDUCT',
    title: 'Conduct policy',
    version: '2026-08-01',
    inForceFrom: '1 August 2026',
    intro:
      'This is the policy you accept at checkout. It applies to you and to your companion equally, and we enforce it in both directions.',
    sections: [
      {
        heading: 'Where you meet',
        body: 'Bookings take place in public places: cafés, restaurants, cinemas, galleries, parks, shops and streets. Not a private home, not a hotel room, not a parked car. If a booking moves to a private place, it ends there.',
      },
      {
        heading: 'What is not on offer',
        body: 'No romantic or sexual conduct of any kind is offered, implied or permitted, at any price. Requests for it are a breach of this policy. Companions do not give out their real names, addresses or personal numbers.',
      },
      {
        heading: 'Ending a booking early',
        emphasis: true,
        body: 'Your companion may end a booking immediately, without discussion, if this policy is breached. No refund is due in that case, and we record the incident. You may end a booking at any time for any reason; whether a refund is due follows the refund policy.',
      },
      {
        heading: 'What we do and do not check',
        body: 'Companions sign this policy before being listed and are photographed for their profile. We do not run police or background checks, and we do not describe anyone as verified, screened or background-checked. Reviews marked verified mean only that the reviewer completed a booking.',
      },
      {
        heading: 'Reporting something',
        body: `Call or message us during service hours and we will act the same day. Every report is written into an incident record attached to the booking, whether or not the booking was ended. Reach us on ${SUPPORT_PHONE}.`,
      },
    ],
  },

  refunds: {
    slug: 'refunds',
    navLabel: 'REFUNDS',
    title: 'Cancellation and refund policy',
    version: '2026-08-01',
    inForceFrom: '1 August 2026',
    intro:
      'You always see the exact refund amount before you confirm a cancellation. Refunds go back to the card, account or UPI ID you paid from — we cannot send them anywhere else.',
    sections: [
      {
        heading: 'If you cancel',
        body: 'More than 48 hours before the booking starts: full refund. Between 24 and 48 hours before: 50%. Inside 24 hours: no refund, because the time has been held for you and your companion has turned down other bookings for it.',
      },
      {
        heading: 'If your companion cancels or does not arrive',
        body: 'Full refund, every time, with no time limit and no argument. We will also offer you a priority rebooking with someone else.',
      },
      {
        heading: 'If the booking is ended for a conduct breach',
        emphasis: true,
        body: 'If your companion ends the booking because the conduct policy was broken, no refund is due. We record an incident against the booking in every such case.',
      },
      {
        heading: 'If you do not arrive',
        body: 'No refund. Your companion waited at the place and time you chose.',
      },
      {
        heading: 'How long it takes',
        body: 'We start the refund with our payment provider as soon as the cancellation is confirmed. Banks typically take 5 to 7 working days to show it. The reference on your ticket is all you need if you have to ask us about it.',
      },
      {
        heading: 'Rescheduling',
        body: 'We can move a booking rather than cancel it. Call us — there is no charge for moving a booking more than 24 hours ahead, subject to your companion being free.',
      },
    ],
  },

  privacy: {
    slug: 'privacy',
    navLabel: 'PRIVACY',
    title: 'Privacy notice',
    version: '2026-08-01',
    inForceFrom: '1 August 2026',
    intro:
      'Issued under the Digital Personal Data Protection Act, 2023. We collect the least we can and keep it for as short a time as we can.',
    sections: [
      {
        heading: 'What we collect, and why',
        body: 'Your phone number, so we can verify it is you and send your confirmation on WhatsApp. Your full name, so your companion knows who he is meeting — he is told your first name only. The area you chose, so we can arrange the meeting. An optional note, if you write one. Nothing else: no email, no address, no photograph, no contacts, no location tracking.',
      },
      {
        heading: 'What we do not do',
        emphasis: true,
        body: 'We do not sell your data. We do not share it with advertisers. We do not give your phone number to your companion — coordination goes through our business number so there is a record of it.',
      },
      {
        heading: 'How long we keep it',
        body: 'Booking records, including your name and the area, are kept for 24 months from the booking date. We keep them that long because payment disputes, refunds and any incident record may need to be looked at again. After 24 months they are deleted.',
      },
      {
        heading: 'Deleting your data',
        body: `Ask us and we will delete it. Email ${GRIEVANCE_EMAIL} or call ${SUPPORT_PHONE} from the number on the account. We will confirm within 7 days and complete it within 30. We may have to keep the minimum needed for tax and payment records, and we will tell you exactly what that is.`,
      },
      {
        heading: 'Who processes it for us',
        body: 'Supabase hosts our database. Cashfree Payments processes payments and holds the payment records the law requires them to hold — we never see or store your card or UPI credentials. Vercel hosts the website. Google Analytics gives us anonymous traffic figures.',
      },
      {
        heading: 'Grievance contact',
        body: `Under the DPDP Act you can raise a grievance with our Grievance Officer at ${GRIEVANCE_EMAIL} or ${SUPPORT_PHONE}. We respond within 7 days. If you are not satisfied you may complain to the Data Protection Board of India.`,
      },
    ],
  },

  terms: {
    slug: 'terms',
    navLabel: 'TERMS',
    title: 'Terms of service',
    version: '2026-08-01',
    inForceFrom: '1 August 2026',
    intro:
      'The agreement between you and AlongCo when you book. Your booking is governed by the version of these terms you accepted at checkout.',
    sections: [
      {
        heading: 'What we sell',
        body: 'A booked block of time — one hour or more — with a companion, in a public place in Bangalore, at a price shown before you pay. That is the whole of it. We are not selling friendship, romance, or any outcome from the meeting.',
      },
      {
        heading: 'Who can book',
        body: 'You must be 18 or over. One account per phone number. We may refuse or cancel a booking, and may block an account, if the conduct policy is breached or if we believe someone is at risk.',
      },
      {
        heading: 'Paying',
        body: 'The full amount is due at checkout, in Indian rupees, through Cashfree Payments. The price is fixed when you book: if we change a companion’s rate afterwards, you still pay what your ticket says. We hold your slot for ten minutes while you pay, and nothing is charged if that hold lapses.',
      },
      {
        heading: 'Timing',
        body: 'Bookings run between 8am and 10pm IST and must finish by 10pm. The minimum is one hour. Bookings cannot be extended once they start — book the length you want up front. There is a 15-minute gap after every booking.',
      },
      {
        heading: 'Cancelling',
        body: 'See the cancellation and refund policy, which forms part of these terms. You always see the refund amount before confirming.',
      },
      {
        heading: 'Conduct',
        emphasis: true,
        body: 'The conduct policy forms part of these terms and you accept it at checkout. Your companion may end a booking immediately for a breach, with no refund.',
      },
      {
        heading: 'What we are responsible for',
        body: 'We arrange the booking, hold the payment, keep the record and act on reports. We do not supervise the meeting itself. We do not describe companions as verified or background-checked, because we do not run background checks — what we have is a signed conduct agreement, a current photograph and a record of every booking. You remain responsible for your own decisions about where you go and how long you stay.',
      },
      {
        heading: 'Governing law',
        body: 'These terms are governed by the laws of India, and the courts at Bangalore have jurisdiction.',
      },
      {
        heading: 'Changes',
        body: 'We keep every previous version and will provide one on request. A change never applies retrospectively to a booking already made.',
      },
    ],
  },
}
