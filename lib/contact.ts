/**
 * Operator contact details. Placeholders until the business line is live — the
 * design canvas marks these as the one thing still to be filled in.
 */
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '+91 80 4xxx xxxx'
export const SUPPORT_PHONE_HREF = `tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}`
export const GRIEVANCE_EMAIL =
  process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL ?? 'grievance@alongco.com'
export const SERVICE_HOURS_LABEL = 'any time we are open'
export const SERVICE_HOURS_SHORT = '8AM–10PM IST'
export const CITY = 'Bangalore'
