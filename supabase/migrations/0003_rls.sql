-- AlongCo — 0003_rls.sql
-- Row level security and the auth-dependent RPCs.
--
-- CLAUDE.md §3.9: RLS on for every table, deny by default. A table with RLS
-- enabled and no policy is readable only by service_role — that is the intended
-- state for identities, payments, refunds, incidents and the audit log.

-- ---------------------------------------------------------------------------
-- Enable on everything. No exceptions.
-- ---------------------------------------------------------------------------

alter table settings               enable row level security;
alter table areas                  enable row level security;
alter table companions             enable row level security;
alter table companion_identities   enable row level security;
alter table companion_availability enable row level security;
alter table companion_blackouts    enable row level security;
alter table companion_areas        enable row level security;
alter table customers              enable row level security;
alter table bookings               enable row level security;
alter table booking_events         enable row level security;
alter table payments               enable row level security;
alter table refunds                enable row level security;
alter table webhook_events         enable row level security;
alter table payouts                enable row level security;
alter table reviews                enable row level security;
alter table incidents              enable row level security;
alter table support_tickets        enable row level security;
alter table support_messages       enable row level security;
alter table admin_users            enable row level security;
alter table admin_audit_log        enable row level security;
alter table otp_requests           enable row level security;

-- Force RLS on the tables whose whole point is that nobody sees them, so even a
-- table owner connection is subject to policy.
alter table companion_identities   force row level security;
alter table payments               force row level security;
alter table refunds                force row level security;
alter table admin_audit_log        force row level security;

-- ---------------------------------------------------------------------------
-- Public, read-only surfaces
-- ---------------------------------------------------------------------------

create policy settings_public_read on settings
  for select to anon, authenticated using (is_public);

create policy areas_public_read on areas
  for select to anon, authenticated using (is_active);

-- An inactive companion does not exist to a visitor: no listing, and the
-- profile 404s because this returns no row (PRD §6.1).
create policy companions_public_read on companions
  for select to anon, authenticated using (is_active);

create policy companion_availability_public_read on companion_availability
  for select to anon, authenticated
  using (exists (select 1 from companions c
                  where c.id = companion_availability.companion_id and c.is_active));

create policy companion_areas_public_read on companion_areas
  for select to anon, authenticated
  using (exists (select 1 from companions c
                  where c.id = companion_areas.companion_id and c.is_active));

-- companion_identities: NO POLICY, BY DESIGN. CLAUDE.md §3.6.
-- companion_blackouts: NO POLICY. Reached only via get_availability_inputs,
--   which strips the reason text.

-- ---------------------------------------------------------------------------
-- Customer-owned rows
-- ---------------------------------------------------------------------------

create policy customers_select_own on customers
  for select to authenticated using (auth_user_id = (select auth.uid()));

-- Deliberately no UPDATE policy. If customers could update their own row they
-- could clear is_blocked. Profile edits go through ac_set_customer_profile.

create policy bookings_select_own on bookings
  for select to authenticated
  using (exists (select 1 from customers c
                  where c.id = bookings.customer_id
                    and c.auth_user_id = (select auth.uid())));

-- No INSERT policy: booking creation is create_booking_hold only (§3.9).
-- No UPDATE policy: status changes are server-side only (§3.3).

create policy booking_events_select_own on booking_events
  for select to authenticated
  using (exists (select 1 from bookings b
                   join customers c on c.id = b.customer_id
                  where b.id = booking_events.booking_id
                    and c.auth_user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Reviews — "verified" means tied to a completed booking, nothing more (§3.7)
-- ---------------------------------------------------------------------------

create policy reviews_public_read on reviews
  for select to anon, authenticated using (is_published);

create policy reviews_select_own on reviews
  for select to authenticated
  using (exists (select 1 from customers c
                  where c.id = reviews.customer_id
                    and c.auth_user_id = (select auth.uid())));

create policy reviews_insert_own on reviews
  for insert to authenticated
  with check (
    is_published = false                       -- publication is a moderator's act
    and exists (
      select 1
        from bookings b
        join customers c on c.id = b.customer_id
       where b.id = reviews.booking_id
         and c.auth_user_id = (select auth.uid())
         and c.id = reviews.customer_id
         and b.companion_id = reviews.companion_id
         and b.status = 'completed'
         and b.ends_at < now()
    )
  );

-- payments, refunds, webhook_events, payouts, incidents, support_*,
-- admin_users, admin_audit_log, otp_requests: RLS on, no policies.
-- service_role only. Clients read payment state through their booking.

-- ---------------------------------------------------------------------------
-- Customer bootstrap. Phone comes from the verified JWT, never from an
-- argument, so a caller cannot claim someone else's number.
-- ---------------------------------------------------------------------------

create or replace function ac_ensure_customer(p_consent_version text default null)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_phone text := auth.jwt() ->> 'phone';
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if v_phone is null or v_phone = '' then
    raise exception 'AC_NO_PHONE_CLAIM';
  end if;

  -- Normalise to E.164 without the leading '+', matching what Supabase issues.
  v_phone := regexp_replace(v_phone, '[^0-9]', '', 'g');

  select id into v_id from customers where auth_user_id = v_uid;
  if found then
    if p_consent_version is not null then
      update customers
         set consent_version = p_consent_version,
             consent_at      = coalesce(consent_at, now())
       where id = v_id and consent_version is distinct from p_consent_version;
    end if;
    return v_id;
  end if;

  -- Same number returning on a new auth user: adopt the existing record rather
  -- than orphaning her booking history.
  select id into v_id from customers where phone = v_phone;
  if found then
    update customers set auth_user_id = v_uid where id = v_id;
    return v_id;
  end if;

  insert into customers (auth_user_id, phone, consent_version, consent_at)
  values (v_uid, v_phone, p_consent_version,
          case when p_consent_version is null then null else now() end)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function ac_set_customer_profile(p_full_name text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'AC_INVALID_NAME';
  end if;

  update customers
     set full_name = btrim(p_full_name)
   where auth_user_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_booking_hold — the only way a booking row comes into existence.
--
-- Everything that decides money or time is computed here: the amount from the
-- companion's current rate, the hold TTL and buffer from settings, the window
-- from settings. The caller supplies a slot and a duration and nothing else
-- that matters. CLAUDE.md §3.1, §3.9.
--
-- Raises AC_* messages the server action maps to specific user-facing copy,
-- because "something went wrong" on the slot path is forbidden (§6).
-- ---------------------------------------------------------------------------

create or replace function create_booking_hold(
  p_companion_slug   text,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_area_id          uuid,
  p_terms_version    text,
  p_customer_notes   text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_customer     customers%rowtype;
  v_companion    companions%rowtype;
  v_tz           text;
  v_window_days  integer;
  v_buffer       integer;
  v_hold_minutes integer;
  v_min_minutes  integer;
  v_max_holds    integer;
  v_hours        jsonb;
  v_terms        text;
  v_ends_at      timestamptz;
  v_local_start  timestamp;
  v_local_end    timestamp;
  v_weekday      smallint;
  v_amount       integer;
  v_discount     smallint;
  v_existing     bookings%rowtype;
  v_id           uuid;
  v_reference    text;
  v_hold_expires timestamptz;
begin
  select * into v_customer from customers where auth_user_id = auth.uid();
  if not found then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  -- Neutral refusal, no slot held (PRD §6.3).
  if v_customer.is_blocked then
    raise exception 'AC_BOOKING_REFUSED';
  end if;

  select * into v_companion from companions where slug = p_companion_slug;
  if not found or not v_companion.is_active then
    raise exception 'AC_COMPANION_UNAVAILABLE';
  end if;
  if not v_companion.is_accepting then
    raise exception 'AC_COMPANION_PAUSED';
  end if;

  v_tz           := coalesce(ac_setting('timezone') #>> '{}', 'Asia/Kolkata');
  v_window_days  := ac_setting_int('booking_window_days', 7);
  v_buffer       := ac_setting_int('buffer_minutes', 15);
  v_hold_minutes := ac_setting_int('hold_minutes', 10);
  v_min_minutes  := ac_setting_int('min_duration_minutes', 60);
  v_max_holds    := ac_setting_int('max_active_holds', 3);
  v_hours        := ac_setting('service_hours');
  v_terms        := ac_setting('terms_version') #>> '{}';

  if p_terms_version is null or p_terms_version is distinct from v_terms then
    raise exception 'AC_TERMS_STALE';
  end if;

  if p_duration_minutes < v_min_minutes then
    raise exception 'AC_DURATION_TOO_SHORT';
  end if;
  if p_duration_minutes % 30 <> 0 then
    raise exception 'AC_DURATION_INVALID';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);

  if p_starts_at < now() then
    raise exception 'AC_SLOT_IN_PAST';
  end if;
  if p_starts_at > now() + make_interval(days => v_window_days) then
    raise exception 'AC_OUTSIDE_WINDOW';
  end if;

  -- Service hours are wall-clock IST, so compare in local time.
  v_local_start := p_starts_at at time zone v_tz;
  v_local_end   := v_ends_at   at time zone v_tz;
  v_weekday     := extract(dow from v_local_start)::smallint;

  if v_local_start::time < (v_hours ->> 'start')::time
     or v_local_end::time > (v_hours ->> 'end')::time
     or v_local_end::date <> v_local_start::date then
    raise exception 'AC_OUTSIDE_SERVICE_HOURS';
  end if;

  if not exists (
    select 1 from companion_areas ca
      join areas a on a.id = ca.area_id
     where ca.companion_id = v_companion.id
       and ca.area_id = p_area_id
       and a.is_active
  ) then
    raise exception 'AC_AREA_UNAVAILABLE';
  end if;

  if not exists (
    select 1 from companion_availability av
     where av.companion_id = v_companion.id
       and av.weekday = v_weekday
       and av.start_time <= v_local_start::time
       and av.end_time   >= v_local_end::time
  ) then
    raise exception 'AC_NOT_WORKING';
  end if;

  if exists (
    select 1 from companion_blackouts b
     where b.companion_id = v_companion.id
       and b.starts_at < v_ends_at
       and b.ends_at   > p_starts_at
  ) then
    raise exception 'AC_SLOT_TAKEN';
  end if;

  -- Retrying a failed payment must resume the same booking, not create a
  -- second one (PRD §6.6).
  select * into v_existing
    from bookings
   where customer_id = v_customer.id
     and companion_id = v_companion.id
     and starts_at = p_starts_at
     and status = 'pending_payment'
     and hold_expires_at > now()
   limit 1;
  if found then
    return jsonb_build_object(
      'booking_id',      v_existing.id,
      'reference',       v_existing.reference,
      'amount_paise',    v_existing.amount_paise,
      'hold_expires_at', v_existing.hold_expires_at,
      'resumed',         true
    );
  end if;

  if (select count(*) from bookings
       where customer_id = v_customer.id
         and status = 'pending_payment'
         and hold_expires_at > now()) >= v_max_holds then
    raise exception 'AC_TOO_MANY_HOLDS';
  end if;

  select q.amount_paise, q.discount_percent
    into v_amount, v_discount
    from ac_quote(v_companion.hourly_rate_paise, p_duration_minutes) q;

  v_reference    := ac_generate_reference();
  v_hold_expires := now() + make_interval(mins => v_hold_minutes);

  begin
    insert into bookings (
      reference, customer_id, companion_id, area_id,
      starts_at, ends_at, buffer_minutes,
      status, hold_expires_at,
      amount_paise, rate_snapshot_paise, discount_percent,
      terms_version, terms_accepted_at, customer_notes
    ) values (
      v_reference, v_customer.id, v_companion.id, p_area_id,
      p_starts_at, v_ends_at, v_buffer,
      'pending_payment', v_hold_expires,
      v_amount, v_companion.hourly_rate_paise, v_discount,
      p_terms_version, now(), nullif(btrim(coalesce(p_customer_notes, '')), '')
    )
    returning id into v_id;
  exception
    when exclusion_violation then
      -- Someone else's hold landed first. §3.5 — this is the database saying no,
      -- not the UI guessing.
      raise exception 'AC_SLOT_TAKEN';
  end;

  insert into booking_events (booking_id, from_status, to_status, actor_type, actor_id, reason)
  values (v_id, null, 'pending_payment', 'customer', v_customer.id, 'hold created');

  return jsonb_build_object(
    'booking_id',      v_id,
    'reference',       v_reference,
    'amount_paise',    v_amount,
    'hold_expires_at', v_hold_expires,
    'resumed',         false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants. Default PUBLIC EXECUTE is revoked first; nothing is callable
-- by a role that has no business calling it.
-- ---------------------------------------------------------------------------

revoke execute on function ac_setting(text)                                        from public;
revoke execute on function ac_setting_int(text, integer)                           from public;
revoke execute on function ac_generate_reference()                                 from public;
revoke execute on function ac_quote(integer, integer)                              from public;
revoke execute on function get_availability_inputs(uuid, timestamptz, timestamptz) from public;
revoke execute on function ac_set_booking_status(uuid, booking_status, text, uuid, text) from public;
revoke execute on function ac_expire_holds()                                       from public;
revoke execute on function ac_complete_bookings()                                  from public;
revoke execute on function ac_refund_quote(uuid, text, timestamptz)                from public;
revoke execute on function ac_ensure_customer(text)                                from public;
revoke execute on function ac_set_customer_profile(text)                           from public;
revoke execute on function create_booking_hold(text, timestamptz, integer, uuid, text, text) from public;

grant execute on function ac_quote(integer, integer)                              to anon, authenticated, service_role;
grant execute on function get_availability_inputs(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function ac_ensure_customer(text)                                to authenticated, service_role;
grant execute on function ac_set_customer_profile(text)                           to authenticated, service_role;
grant execute on function create_booking_hold(text, timestamptz, integer, uuid, text, text) to authenticated, service_role;

grant execute on function ac_setting(text)                                        to service_role;
grant execute on function ac_setting_int(text, integer)                           to service_role;
grant execute on function ac_generate_reference()                                 to service_role;
grant execute on function ac_set_booking_status(uuid, booking_status, text, uuid, text) to service_role;
grant execute on function ac_expire_holds()                                       to service_role;
grant execute on function ac_complete_bookings()                                  to service_role;
grant execute on function ac_refund_quote(uuid, text, timestamptz)                to service_role;
