/**
 * AC_* codes raised by the database functions, mapped to what the customer
 * actually needs to know.
 *
 * CLAUDE.md §6: never "something went wrong" on the payment or slot path — she
 * needs to know whether her money moved and whether she still has the slot.
 * Every message here says what happened and what to do next.
 */

export type BookingErrorCode =
  | 'AC_NOT_AUTHENTICATED'
  | 'AC_BOOKING_REFUSED'
  | 'AC_COMPANION_UNAVAILABLE'
  | 'AC_COMPANION_PAUSED'
  | 'AC_TERMS_STALE'
  | 'AC_DURATION_TOO_SHORT'
  | 'AC_DURATION_INVALID'
  | 'AC_SLOT_IN_PAST'
  | 'AC_OUTSIDE_WINDOW'
  | 'AC_OUTSIDE_SERVICE_HOURS'
  | 'AC_AREA_UNAVAILABLE'
  | 'AC_NOT_WORKING'
  | 'AC_SLOT_TAKEN'
  | 'AC_TOO_MANY_HOLDS'
  | 'AC_BOOKING_NOT_FOUND'
  | 'AC_BOOKING_NOT_EDITABLE'
  | 'AC_HOLD_EXPIRED'
  | 'AC_INVALID_NAME'
  | 'AC_NAME_REQUIRED'
  | 'AC_PHONE_INVALID'
  | 'AC_PHONE_IN_USE'
  | 'AC_AREA_INVALID'
  | 'AC_NOT_EDITABLE'
  | 'AC_NOT_CANCELLABLE'

const MESSAGES: Record<BookingErrorCode, string> = {
  AC_NOT_AUTHENTICATED: 'Please sign in again — your session has expired.',
  AC_BOOKING_REFUSED:
    'We are not able to take this booking. Please call us and we will explain.',
  AC_COMPANION_UNAVAILABLE: 'He is no longer listed. Have a look at who else is free.',
  AC_COMPANION_PAUSED:
    'He has paused his bookings since you opened this page. Nothing was charged.',
  AC_TERMS_STALE:
    'Our conduct terms changed while you were booking. Reload the page to read the current version before you pay.',
  AC_DURATION_TOO_SHORT: 'The shortest booking is one hour.',
  AC_DURATION_INVALID: 'That length is not one we offer. Pick 1, 2 or 3 hours.',
  AC_SLOT_IN_PAST: 'That time has passed. Pick a later one.',
  AC_OUTSIDE_WINDOW: 'Bookings open seven days ahead. Pick a nearer date.',
  AC_OUTSIDE_SERVICE_HOURS:
    'Bookings run from 8am to 10pm, and must finish by 10pm. Pick an earlier start.',
  AC_AREA_UNAVAILABLE: 'He does not cover that area. Pick one of the areas listed.',
  AC_NOT_WORKING: 'He is not working then. Pick another time from the list.',
  AC_SLOT_TAKEN:
    'That slot was just taken. Nothing was charged — here are the times still free.',
  AC_TOO_MANY_HOLDS:
    'You already have three slots held. Finish or drop one of those before holding another.',
  AC_BOOKING_NOT_FOUND: 'We cannot find that booking on your account.',
  AC_BOOKING_NOT_EDITABLE: 'This booking can no longer be changed here. Please call us.',
  AC_HOLD_EXPIRED:
    'Your ten-minute hold ran out, so the slot went back on sale. You were not charged.',
  AC_INVALID_NAME: 'Please enter your full name.',
  AC_NAME_REQUIRED: 'Please enter your full name.',
  AC_PHONE_INVALID:
    'That does not look like an Indian mobile number. We need one that works on WhatsApp, because that is how we confirm.',
  AC_PHONE_IN_USE:
    'That number is already on another account. Use the number for this account, or call us and we will sort it out.',
  AC_AREA_INVALID: 'He does not cover that area. Pick one of the areas listed.',
  AC_NOT_EDITABLE: 'This booking can no longer be changed here. Please call us.',
  AC_NOT_CANCELLABLE: 'This booking cannot be cancelled from here. Please call us.',
}

export const FALLBACK_MESSAGE =
  'We could not complete that, and nothing was charged. Please try again, or call us and we will do it by hand.'

/** Pulls the AC_ code out of a Postgres error message. */
export function bookingErrorCode(error: unknown): BookingErrorCode | null {
  const text =
    typeof error === 'string'
      ? error
      : ((error as { message?: string } | null)?.message ?? '')
  const match = /AC_[A-Z_]+/.exec(text)
  const code = match?.[0] as BookingErrorCode | undefined
  return code && code in MESSAGES ? code : null
}

export function bookingErrorMessage(error: unknown): string {
  const code = bookingErrorCode(error)
  return code ? MESSAGES[code] : FALLBACK_MESSAGE
}

/** Whether the slot list on screen is now stale and should be refetched. */
export function shouldRefreshSlots(error: unknown): boolean {
  const code = bookingErrorCode(error)
  return (
    code === 'AC_SLOT_TAKEN' ||
    code === 'AC_SLOT_IN_PAST' ||
    code === 'AC_NOT_WORKING' ||
    code === 'AC_HOLD_EXPIRED'
  )
}
