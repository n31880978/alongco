/**
 * Which gateway is active, and what a gateway has to be able to do.
 *
 * The provider name is stored on every payment row (0012), never inferred from
 * the environment when reading. A payment captured under one gateway stays
 * attributable to it forever: a refund months later has to go back through
 * whoever actually took the money.
 *
 * This module is import-safe from client components — it holds no secrets and
 * touches no network.
 */

export type PaymentProvider = 'razorpay' | 'cashfree'

/** The gateway new checkouts are opened with. */
export const ACTIVE_PROVIDER: PaymentProvider = 'razorpay'

/** Normalised payment state, independent of any one gateway's vocabulary. */
export type ProviderPaymentStatus = 'captured' | 'failed' | 'pending'

/** Normalised refund state. Mirrors the refund_status enum. */
export type ProviderRefundStatus = 'created' | 'pending' | 'success' | 'failed'
