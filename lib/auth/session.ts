import 'server-only'

/**
 * Customer identity stub.
 *
 * There is no customer login. The booking is the identity — name, email, phone
 * and preferences are collected on the booking form and stored under the
 * customer row. The ticket (AC-XXXXXX + QR) is proof of booking.
 *
 * This file is kept so imports that previously called getCurrentCustomer() or
 * requireCustomer() still compile while they are migrated to the new pattern
 * (service-role reads keyed on booking reference or email).
 *
 * Admin auth (Supabase email+password) is untouched — see lib/admin/auth.ts.
 */

export async function getCurrentCustomer() {
  return null
}

export async function requireCustomer() {
  return null
}
