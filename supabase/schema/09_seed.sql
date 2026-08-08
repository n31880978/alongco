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
