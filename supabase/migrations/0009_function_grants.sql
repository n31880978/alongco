-- AlongCo — 0009_function_grants.sql
--
-- Asserts, explicitly and in one place, which roles may execute which function.
--
-- Why this exists: the hosted project was found with `anon` and `authenticated`
-- holding EXECUTE on functions that are server-side machinery — including
-- ac_set_booking_status, which is what marks a booking confirmed. A blanket
-- `grant execute on all functions` had been applied at some point, silently
-- widening what the earlier migrations had deliberately revoked.
--
-- Nothing was exploitable at the time it was found: `bookings` has no UPDATE
-- policy, so ac_set_booking_status's `select … for update` is filtered out by
-- RLS and raises AC_BOOKING_NOT_FOUND. But that is defence by accident. It holds
-- only until someone adds an UPDATE policy for a good reason, and then a
-- signed-in customer can confirm her own booking without paying.
--
-- PUBLIC holds EXECUTE on new functions by default, so every entry revokes from
-- public first and then grants only what is needed.

-- ---------------------------------------------------------------------------
-- Server-side only. No client role ever calls these.
--
-- SECURITY DEFINER functions call them internally and run as their owner, so
-- revoking here does not break create_booking_hold, ac_cancel_own_booking or
-- any other customer-facing path.
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'ac_set_booking_status(uuid, booking_status, text, uuid, text)',
    'ac_refund_quote(uuid, text, timestamptz)',
    'ac_expire_holds()',
    'ac_complete_bookings()',
    'ac_quote(integer, integer)',
    'ac_generate_reference()',
    'ac_setting(text)',
    'ac_setting_int(text, integer)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant  execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Customer-facing. Each of these checks auth.uid() itself and raises
-- AC_NOT_AUTHENTICATED, so `anon` has nothing to gain — but it is revoked
-- anyway, so the refusal is a permission error rather than a business-logic
-- error that happens to be correct.
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'create_booking_hold(text, timestamptz, integer, uuid, text, text)',
    'ac_ensure_customer(text)',
    'ac_set_customer_profile(text)',
    'ac_set_booking_details(uuid, text, uuid, text)',
    'ac_cancel_own_booking(uuid, text)',
    'ac_quote_own_cancellation(uuid)',
    'ac_check_action_rate_limit(text, uuid)',
    'ac_review_publishable(uuid)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon', fn);
      execute format('grant  execute on function %s to authenticated, service_role', fn);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Genuinely public.
--
-- get_availability_inputs backs the slot picker before sign-in, and the OTP
-- limiter necessarily runs before there is a session at all.
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'get_availability_inputs(uuid, timestamptz, timestamptz)',
    'ac_consume_otp_rate_limit(text, text)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public', fn);
      execute format('grant  execute on function %s to anon, authenticated, service_role', fn);
    end if;
  end loop;
end
$$;

-- Admin machinery: service_role and nothing else.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text)',
    'ac_refund_reference(text)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant  execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;
