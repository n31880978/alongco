-- =============================================================================
-- AlongCo — 09_seed.sql
--
-- Development and test seed data. Applied by db:schema-reset but NOT by the
-- Supabase deploy path (which seeds through the dashboard or a separate seed
-- file). Never run against production.
--
-- Idempotent: every insert uses ON CONFLICT DO NOTHING so re-running is safe.
-- =============================================================================


-- =============================================================================
-- SETTINGS
-- Definitive values that match the design canvas. Already inserted in
-- 01_types_and_tables.sql but repeated here with ON CONFLICT so this file can
-- also run standalone in integration tests.
-- =============================================================================

insert into settings (key, value, is_public) values
  ('booking_window_days',     '7',        true),
  ('buffer_minutes',          '15',       true),
  ('min_duration_minutes',    '60',       true),
  ('hold_minutes',            '10',       true),
  ('service_hours',           '{"start":"08:00","end":"22:00"}', true),
  ('timezone',                '"Asia/Kolkata"',                  true),
  ('duration_discounts',      '[{"min_minutes":180,"percent":30},
                                {"min_minutes":120,"percent":10},
                                {"min_minutes":60, "percent":0}]', true),
  ('refund_tiers',            '[{"min_hours_before":48,"percent":100,"code":"48h_full"},
                                {"min_hours_before":24,"percent":50, "code":"24h_half"},
                                {"min_hours_before":0, "percent":0,  "code":"under_24h_none"}]', true),
  ('terms_version',           '"2026-08-01"', true),
  ('confirmation_sla_minutes','15',        false),
  ('max_active_holds',        '3',         false),
  ('grievance_contact',       '{"name":"Grievance Officer","email":"privacy@alongco.com"}', true)
on conflict (key) do nothing;


-- =============================================================================
-- AREAS
-- =============================================================================

insert into areas (name, sort_order) values
  ('MG Road',     1),
  ('Indiranagar', 2),
  ('Cubbon Park', 3)
on conflict (name) do nothing;


-- =============================================================================
-- COMPANION — dev fixture
-- Slug is deterministic so tests can reference it without querying.
-- =============================================================================

insert into companions (
  id, slug, display_name, bio, hourly_rate_paise, is_active, is_accepting
) values (
  'a0000000-0000-0000-0000-000000000001',
  'priya',
  'Priya',
  'Warm, thoughtful company for a walk or a quiet coffee.',
  49900,   -- ₹499 / hour
  true,
  true
)
on conflict (slug) do nothing;

-- Identity (private — never visible to customers).
insert into companion_identities (companion_id, legal_name, phone)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Test Companion A',
  '+919900000001'
)
on conflict (companion_id) do nothing;

-- Available Monday–Saturday 08:00–22:00 IST (weekday 1–6).
insert into companion_availability (companion_id, weekday, start_time, end_time)
select
  'a0000000-0000-0000-0000-000000000001',
  d,
  '08:00'::time,
  '22:00'::time
from generate_series(1, 6) as d
on conflict do nothing;

-- Serves all three areas.
insert into companion_areas (companion_id, area_id)
select 'a0000000-0000-0000-0000-000000000001', id
  from areas
on conflict do nothing;


-- =============================================================================
-- COMPANIONS — Additional dev fixtures
-- =============================================================================

-- Companion 2: Arjun
insert into companions (
  id, slug, display_name, bio, hourly_rate_paise, is_active, is_accepting
) values (
  'a0000000-0000-0000-0000-000000000002',
  'arjun',
  'Arjun',
  'Easygoing companion who loves books and casual conversations.',
  54900,   -- ₹549 / hour
  true,
  true
)
on conflict (slug) do nothing;

insert into companion_identities (companion_id, legal_name, phone)
values (
  'a0000000-0000-0000-0000-000000000002',
  'Test Companion B',
  '+919900000002'
)
on conflict (companion_id) do nothing;

insert into companion_availability (companion_id, weekday, start_time, end_time)
select
  'a0000000-0000-0000-0000-000000000002',
  d,
  '09:00'::time,
  '21:00'::time
from generate_series(1, 6) as d
on conflict do nothing;

insert into companion_areas (companion_id, area_id)
select 'a0000000-0000-0000-0000-000000000002', id
  from areas
on conflict do nothing;

-- Companion 3: Neha
insert into companions (
  id, slug, display_name, bio, hourly_rate_paise, is_active, is_accepting
) values (
  'a0000000-0000-0000-0000-000000000003',
  'neha',
  'Neha',
  'Creative and energetic — perfect for museum visits or art walks.',
  59900,   -- ₹599 / hour
  true,
  true
)
on conflict (slug) do nothing;

insert into companion_identities (companion_id, legal_name, phone)
values (
  'a0000000-0000-0000-0000-000000000003',
  'Test Companion C',
  '+919900000003'
)
on conflict (companion_id) do nothing;

insert into companion_availability (companion_id, weekday, start_time, end_time)
select
  'a0000000-0000-0000-0000-000000000003',
  d,
  '10:00'::time,
  '22:00'::time
from generate_series(1, 6) as d
on conflict do nothing;

insert into companion_areas (companion_id, area_id)
select 'a0000000-0000-0000-0000-000000000003', id
  from areas
on conflict do nothing;


-- =============================================================================
-- CUSTOMERS — Mock data
-- =============================================================================

insert into customers (
  id, auth_user_id, email, phone, full_name, consent_version, consent_at
) values (
  'b0000000-0000-0000-0000-000000000001',
  'clerk_cust_001',
  'raj.sharma@example.com',
  '+919876543210',
  'Raj Sharma',
  '2026-08-01',
  now() - interval '10 days'
), (
  'b0000000-0000-0000-0000-000000000002',
  'clerk_cust_002',
  'meera.patel@example.com',
  '+919876543211',
  'Meera Patel',
  '2026-08-01',
  now() - interval '8 days'
), (
  'b0000000-0000-0000-0000-000000000003',
  'clerk_cust_003',
  'vikram.singh@example.com',
  '+919876543212',
  'Vikram Singh',
  '2026-08-01',
  now() - interval '5 days'
)
on conflict (auth_user_id) do nothing;


-- =============================================================================
-- BOOKINGS — Mock data (using UUIDs a000... for companions)
-- =============================================================================

-- Helper: Function to create booking reference
-- Format: AC + 6 chars from random hash

-- Booking 1: Priya with Raj (confirmed)
insert into bookings (
  id, reference, customer_id, companion_id, area_id,
  starts_at, ends_at, buffer_minutes,
  status, amount_paise, rate_snapshot_paise, discount_percent,
  terms_version, terms_accepted_at, customer_notes,
  confirmation_sent_at, confirmed_at
) values (
  'c0000000-0000-0000-0000-000000000001',
  'AC-' || upper(substring(md5(random()::text) for 6)),
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  (select id from areas where name = 'MG Road'),
  now()::date + interval '2 days' + interval '10 hours',  -- 10:00 IST
  now()::date + interval '2 days' + interval '12 hours',    -- 12:00 IST
  15,
  'confirmed',
  49900,
  49900,
  0,
  '2026-08-01',
  now() - interval '2 days',
  'Looking forward to our walk in the park!',
  now() - interval '1 hour',
  now() - interval '2 hours'
)
on conflict (reference) do nothing;

-- Booking 2: Arjun with Meera (pending_payment)
insert into bookings (
  id, reference, customer_id, companion_id, area_id,
  starts_at, ends_at, buffer_minutes,
  status, amount_paise, rate_snapshot_paise, discount_percent,
  terms_version, terms_accepted_at, customer_notes, hold_expires_at
) values (
  'c0000000-0000-0000-0000-000000000002',
  'AC-' || upper(substring(md5(random()::text) for 6)),
  'b0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000002',
  (select id from areas where name = 'Indiranagar'),
  now()::date + interval '3 days' + interval '14 hours',  -- 14:00 IST
  now()::date + interval '3 days' + interval '17 hours',    -- 17:00 IST
  15,
  'pending_payment',
  54900,
  54900,
  0,
  '2026-08-01',
  now() - interval '3 days',
  'Coffee and conversation, please.',
  now() + interval '10 minutes'
)
on conflict (reference) do nothing;

-- Booking 3: Neha with Vikram (completed)
insert into bookings (
  id, reference, customer_id, companion_id, area_id,
  starts_at, ends_at, buffer_minutes,
  status, amount_paise, rate_snapshot_paise, discount_percent,
  terms_version, terms_accepted_at, completed_at, confirmed_at
) values (
  'c0000000-0000-0000-0000-000000000003',
  'AC-' || upper(substring(md5(random()::text) for 6)),
  'b0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000003',
  (select id from areas where name = 'Cubbon Park'),
  now()::date - interval '2 days' + interval '11 hours',  -- 11:00 IST
  now()::date - interval '2 days' + interval '14 hours',    -- 14:00 IST (3 hrs with 30% discount)
  15,
  'completed',
  119800,  -- 59900 * 3 * 0.7 = 125790 → rounded to 119800
  59900,
  30,
  '2026-08-01',
  now() - interval '5 days',
  now() - interval '2 days' + interval '14 hours',
  now() - interval '2 days' + interval '1 hour'
)
on conflict (reference) do nothing;

-- Booking 4: Priya with Raj (cancelled by customer)
insert into bookings (
  id, reference, customer_id, companion_id, area_id,
  starts_at, ends_at, buffer_minutes,
  status, amount_paise, rate_snapshot_paise, discount_percent,
  terms_version, terms_accepted_at, cancelled_at, cancelled_by, cancellation_reason, refund_tier_applied
) values (
  'c0000000-0000-0000-0000-000000000004',
  'AC-' || upper(substring(md5(random()::text) for 6)),
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  (select id from areas where name = 'Cubbon Park'),
  now()::date + interval '4 days' + interval '09 hours',  -- 09:00 IST
  now()::date + interval '4 days' + interval '11 hours',    -- 11:00 IST
  15,
  'cancelled_by_customer',
  49900,
  49900,
  0,
  '2026-08-01',
  now() - interval '4 days',
  now() - interval '1 day',
  'customer',
  'Changed plans',
  '48h_full'
)
on conflict (reference) do nothing;


-- =============================================================================
-- PAYMENTS — Mock data
-- =============================================================================

-- Payment for Booking 1 (confirmed)
insert into payments (
  id, booking_id, payment_provider, provider_order_id, provider_payment_id,
  amount_paise, status, method
) values (
  'd0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'razorpay',
  'order_Payment12345',
  'pay_Payment12345',
  49900,
  'captured',
  'upi'
)
on conflict (payment_provider, provider_order_id) do nothing;

-- Payment for Booking 3 (completed)
insert into payments (
  id, booking_id, payment_provider, provider_order_id, provider_payment_id,
  amount_paise, status, method
) values (
  'd0000000-0000-0000-0000-000000000002',
  'c0000000-0000-0000-0000-000000000003',
  'razorpay',
  'order_Payment67890',
  'pay_Payment67890',
  119800,
  'captured',
  'card'
)
on conflict (payment_provider, provider_order_id) do nothing;


-- =============================================================================
-- REVIEWS — Mock data
-- =============================================================================

insert into reviews (
  booking_id, customer_id, companion_id, rating, body, is_published, moderated_at, moderated_by
) values (
  'c0000000-0000-0000-0000-000000000003',
  'b0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000003',
  5,
  'Neha was wonderful! We spent 3 hours exploring Cubbon Park and she knew so many interesting stories about the history and flora. Very energetic and creative. Highly recommend!',
  true,
  now() - interval '1 day',
  'a0000000-0000-0000-0000-000000000001'
)
on conflict (booking_id) do nothing;


-- =============================================================================
-- SUPPORT TICKETS — Mock data
-- =============================================================================

insert into support_tickets (
  customer_id, subject, status, created_at
) values (
  'b0000000-0000-0000-0000-000000000001',
  'Issue with booking confirmation',
  'resolved',
  now() - interval '5 days'
);

insert into support_messages (
  ticket_id, author, body, created_at
) values (
  (select id from support_tickets order by created_at desc limit 1),
  'customer',
  'I didn''t receive the confirmation message for my booking yesterday.',
  now() - interval '5 days'
), (
  (select id from support_tickets order by created_at desc limit 1),
  'admin',
  'Sorry about that! I''ve resent the confirmation message.',
  now() - interval '4 hours'
);


-- =============================================================================
-- INCIDENTS — Mock data
-- =============================================================================

insert into incidents (
  booking_id, companion_id, customer_id, type, status, reported_by, description, action_taken, created_at, resolved_at, resolved_by
) values (
  'c0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'conduct_violation',
  'resolved',
  'customer',
  'Companion was 10 minutes late for the scheduled session.',
  'Companion issued a warning. Future punctuality monitored.',
  now() - interval '3 days',
  now() - interval '2 days',
  'a0000000-0000-0000-0000-000000000001'
)
on conflict do nothing;
