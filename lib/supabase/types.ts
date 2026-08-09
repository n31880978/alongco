/**
 * Database types.
 *
 * Hand-maintained against supabase/migrations/*.sql. Regenerate with
 *   supabase gen types typescript --db-url "$DATABASE_URL" --schema public
 * once a hosted project exists; until then keep this in step with the migrations
 * by hand — every column here is one the app actually reads or writes.
 */

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'cancelled_by_customer'
  | 'cancelled_by_admin'
  | 'ended_early'
  | 'no_show_customer'
  | 'no_show_companion'
  | 'expired'

export type PaymentStatus =
  | 'created'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'

export type RefundStatus = 'created' | 'pending' | 'success' | 'failed'

export type IncidentType =
  | 'conduct_violation'
  | 'safety_concern'
  | 'no_show'
  | 'payment_dispute'
  | 'other'

export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'escalated'
export type PayoutStatus = 'owed' | 'paid'
export type AdminRole = 'owner' | 'ops' | 'support'

export type Companion = {
  id: string
  slug: string
  display_name: string
  bio: string | null
  photo_path: string | null
  hourly_rate_paise: number
  is_active: boolean
  is_accepting: boolean
  created_at: string
}

export type CompanionIdentity = {
  companion_id: string
  legal_name: string
  phone: string
  id_document_path: string | null
  vetted_at: string | null
  vetted_by: string | null
  vetting_notes: string | null
  agreement_signed_at: string | null
}

export type CompanionAvailabilityRule = {
  id: string
  companion_id: string
  weekday: number
  start_time: string
  end_time: string
}

export type CompanionBlackout = {
  id: string
  companion_id: string
  starts_at: string
  ends_at: string
  reason: string | null
}

export type Area = {
  id: string
  name: string
  is_active: boolean
  sort_order: number
}

export type Customer = {
  id: string
  auth_user_id: string | null
  /** Verified at sign-in. The identity the account is keyed on. */
  email: string | null
  /** Self-declared at checkout for WhatsApp coordination, not verified. */
  phone: string | null
  full_name: string | null
  consent_version: string | null
  consent_at: string | null
  is_blocked: boolean
  block_reason: string | null
  created_at: string
  deletion_requested_at: string | null
}

export type Booking = {
  id: string
  reference: string
  customer_id: string
  companion_id: string
  area_id: string
  starts_at: string
  ends_at: string
  buffer_minutes: number
  status: BookingStatus
  hold_expires_at: string | null
  amount_paise: number
  rate_snapshot_paise: number
  discount_percent: number
  terms_version: string
  terms_accepted_at: string
  customer_notes: string | null
  confirmation_sent_at: string | null
  confirmation_sent_by: string | null
  cancelled_at: string | null
  cancelled_by: 'customer' | 'admin' | 'companion' | null
  cancellation_reason: string | null
  refund_tier_applied: string | null
  completed_at: string | null
  confirmed_at: string | null
  created_at: string
}

export type Payment = {
  id: string
  booking_id: string
  payment_provider: 'razorpay' | 'cashfree'
  provider_order_id: string
  provider_payment_id: string | null
  provider_session_id: string | null
  amount_paise: number
  status: PaymentStatus
  method: string | null
  failure_reason: string | null
  created_at: string
  captured_at: string | null
}

export type Refund = {
  id: string
  payment_id: string
  booking_id: string
  provider_refund_id: string | null
  refund_reference: string
  amount_paise: number
  status: RefundStatus
  tier_applied: string | null
  initiated_by: string | null
  notes: string | null
  created_at: string
  settled_at: string | null
}

export type Review = {
  id: string
  booking_id: string
  customer_id: string
  companion_id: string
  rating: number
  body: string | null
  is_published: boolean
  moderated_at: string | null
  moderated_by: string | null
  moderation_note: string | null
  created_at: string
}

export type Incident = {
  id: string
  booking_id: string | null
  companion_id: string | null
  customer_id: string | null
  type: IncidentType
  status: IncidentStatus
  reported_by: 'customer' | 'companion' | 'admin'
  description: string
  action_taken: string | null
  ended_booking: boolean
  refund_issued: boolean
  created_at: string
  created_by: string | null
  resolved_at: string | null
  resolved_by: string | null
}

export type Payout = {
  id: string
  companion_id: string
  period_start: string
  period_end: string
  amount_paise: number
  status: PayoutStatus
  utr_reference: string | null
  paid_at: string | null
  paid_by: string | null
  notes: string | null
  created_at: string
}

export type AdminUser = {
  id: string
  email: string
  role: AdminRole
  is_active: boolean
  created_at: string
}

export type BookingEvent = {
  id: string
  booking_id: string
  from_status: BookingStatus | null
  to_status: BookingStatus
  actor_type: 'customer' | 'companion' | 'admin' | 'system'
  actor_id: string | null
  reason: string | null
  created_at: string
}

export type SettingRow = {
  key: string
  value: unknown
  is_public: boolean
  updated_at: string
  updated_by: string | null
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      settings: Table<SettingRow>
      areas: Table<Area>
      companions: Table<Companion>
      companion_identities: Table<CompanionIdentity>
      companion_availability: Table<CompanionAvailabilityRule>
      companion_blackouts: Table<CompanionBlackout>
      companion_areas: Table<{ companion_id: string; area_id: string }>
      customers: Table<Customer>
      bookings: Table<Booking>
      booking_events: Table<BookingEvent>
      payments: Table<Payment>
      refunds: Table<Refund>
      webhook_events: Table<{
        id: string
        provider: string
        event_id: string
        event_type: string
        payload: unknown
        received_at: string
        processed_at: string | null
        process_error: string | null
      }>
      payouts: Table<Payout>
      reviews: Table<Review>
      incidents: Table<Incident>
      admin_users: Table<AdminUser>
      admin_audit_log: Table<{
        id: string
        admin_id: string
        action: string
        entity_type: string
        entity_id: string | null
        metadata: unknown
        created_at: string
      }>
      otp_requests: Table<{
        id: string
        identifier_hash: string
        ip_hash: string
        requested_at: string
      }>
      admin_login_attempts: Table<{
        id: string
        email_hash: string
        ip_hash: string
        succeeded: boolean
        attempted_at: string
      }>
      support_tickets: Table<{
        id: string
        customer_id: string | null
        booking_id: string | null
        subject: string
        status: string
        assigned_to: string | null
        created_at: string
      }>
      support_messages: Table<{
        id: string
        ticket_id: string
        author: string
        body: string
        created_at: string
      }>
    }
    Views: Record<string, never>
    Functions: {
      create_booking_hold: {
        Args: {
          p_companion_slug: string
          p_starts_at: string
          p_duration_minutes: number
          p_area_id: string
          p_terms_version: string
          p_full_name: string
          p_email: string
          p_phone: string
          p_preferences?: string | null
          p_customer_notes?: string | null
        }
        Returns: {
          booking_id: string
          reference: string
          amount_paise: number
          hold_expires_at: string
          resumed: boolean
          customer_id?: string
        }
      }
      get_availability_inputs: {
        Args: { p_companion_id: string; p_from: string; p_to: string }
        Returns: {
          companion_id: string
          is_accepting: boolean
          hourly_rate_paise: number
          rules: { weekday: number; start_time: string; end_time: string }[]
          blackouts: { starts_at: string; ends_at: string }[]
          busy: { starts_at: string; ends_at: string }[]
        } | null
      }
      ac_ensure_customer: {
        // Keep this required in the generated-client shape even though the SQL
        // function has a default. supabase-js treats an all-optional Args type
        // as a no-argument RPC and would reject the consent payload.
        Args: { p_consent_version: string | null }
        Returns: string
      }
      ac_consume_otp_rate_limit: {
        Args: { p_identifier_hash: string; p_ip_hash: string }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          scope: string | null
        }[]
      }
      ac_set_customer_profile: { Args: { p_full_name: string }; Returns: undefined }
      ac_set_booking_details: {
        Args: {
          p_booking_id: string
          p_full_name: string
          p_phone: string
          p_area_id: string
          p_notes?: string | null
        }
        Returns: { booking_id: string; hold_expires_at: string }
      }
      ac_cancel_own_booking: {
        Args: { p_booking_id: string; p_reason?: string | null }
        Returns: {
          refund_amount_paise: number
          refund_percent: number
          tier_code: string
          was_paid: boolean
        }
      }
      ac_quote_own_cancellation: {
        Args: { p_booking_id: string }
        Returns: {
          refund_amount_paise: number
          refund_percent: number
          tier_code: string
          amount_paid_paise: number
        }
      }
      ac_quote: {
        Args: { p_rate_paise: number; p_minutes: number }
        Returns: { amount_paise: number; discount_percent: number }[]
      }
      ac_refund_quote: {
        Args: { p_booking_id: string; p_trigger?: string; p_now?: string }
        Returns: { amount_paise: number; percent: number; tier_code: string }[]
      }
      ac_set_booking_status: {
        Args: {
          p_booking_id: string
          p_to: BookingStatus
          p_actor_type: string
          p_actor_id?: string | null
          p_reason?: string | null
        }
        Returns: BookingStatus
      }
      ac_admin_cancel_booking: {
        Args: {
          p_booking_id: string
          p_admin_id: string
          p_trigger: string
          p_reason?: string | null
          p_incident_type?: IncidentType | null
          p_incident_description?: string | null
        }
        Returns: {
          to_status: BookingStatus
          tier_code: string
          percent: number
          refund_amount_paise: number
          refund_id: string | null
          refund_reference: string | null
          incident_id: string | null
          payment_provider: string | null
          provider_order_id: string | null
          provider_payment_id: string | null
        }
      }
      ac_review_publishable: { Args: { p_review_id: string }; Returns: boolean }
      ac_consume_admin_login_attempt: {
        Args: { p_email_hash: string; p_ip_hash: string }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          scope: string | null
        }[]
      }
      ac_record_admin_login_attempt: {
        Args: { p_email_hash: string; p_ip_hash: string; p_succeeded: boolean }
        Returns: undefined
      }
      ac_check_action_rate_limit: {
        Args: { p_action: string; p_customer_id: string }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          reason: string | null
        }[]
      }
      ac_expire_holds: { Args: Record<string, never>; Returns: number }
      ac_complete_bookings: { Args: Record<string, never>; Returns: number }
      get_booking_by_reference: {
        Args: { p_reference: string }
        Returns: {
          id: string
          reference: string
          status: string
          starts_at: string
          ends_at: string
          amount_paise: number
          rate_snapshot_paise: number
          discount_percent: number
          hold_expires_at: string | null
          terms_version: string
          terms_accepted_at: string
          customer_notes: string | null
          area_id: string
          area_name: string
          companion_slug: string
          companion_name: string
          companion_photo_path: string | null
          confirmed_at: string | null
          cancelled_at: string | null
          refund_tier_applied: string | null
          payment_method: string | null
          customer_full_name: string | null
          customer_email: string | null
          customer_phone: string | null
        } | null
      }
      list_bookings_by_email: {
        Args: { p_email: string }
        Returns: {
          id: string
          reference: string
          status: string
          starts_at: string
          ends_at: string
          amount_paise: number
          area_name: string
          companion_name: string
          companion_slug: string
        }[]
      }
    }
    Enums: {
      booking_status: BookingStatus
      payment_status: PaymentStatus
      refund_status: RefundStatus
      incident_type: IncidentType
      incident_status: IncidentStatus
      payout_status: PayoutStatus
    }
    CompositeTypes: Record<string, never>
  }
}
