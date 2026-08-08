-- =============================================================================
-- AlongCo — 07_grants.sql
--
-- Explicit EXECUTE grants for every function.
-- PUBLIC holds EXECUTE by default on new functions, so every entry revokes
-- from PUBLIC first, then grants only to the roles that need it.
--
-- Why this exists as a separate file: a blanket `grant execute on all functions`
-- has been applied to this project before, silently widening what earlier files
-- deliberately revoked. Having grants here means a re-run always restores the
-- intended state, regardless of what happened out-of-band.
-- =============================================================================

do $$
declare
  fn text;
begin
  -- ── Server-side only ─────────────────────────────────────────────────────
  -- These are internal helpers or elevated operations. No client role calls
  -- them directly. SECURITY DEFINER functions call them as their owner, so
  -- revoking here does not break any customer-facing path.
  foreach fn in array array[
    'ac_set_booking_status(uuid, booking_status, text, uuid, text)',
    'ac_refund_quote(uuid, text, timestamptz)',
    'ac_expire_holds()',
    'ac_complete_bookings()',
    'ac_quote(integer, integer)',
    'ac_generate_reference()',
    'ac_setting(text)',
    'ac_setting_int(text, integer)',
    'ac_refund_reference(text)',
    'ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text)',
    'ac_consume_admin_login_attempt(text, text)',
    'ac_record_admin_login_attempt(text, text, boolean)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant  execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;

do $$
declare
  fn text;
begin
  -- ── Customer-facing ───────────────────────────────────────────────────────
  -- Each function validates auth.uid() / ac_auth_subject() itself and raises
  -- AC_NOT_AUTHENTICATED, so anon has nothing to gain. Revoked anyway so the
  -- refusal is a permission error, not a business-logic error that happens to be
  -- correct.
  foreach fn in array array[
    'create_booking_hold(text, timestamptz, integer, uuid, text, text)',
    'ac_set_booking_details(uuid, text, text, uuid, text)',
    'ac_cancel_own_booking(uuid, text)',
    'ac_quote_own_cancellation(uuid)',
    'ac_set_customer_profile(text)',
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

do $$
declare
  fn text;
begin
  -- ── Genuinely public ──────────────────────────────────────────────────────
  -- get_availability_inputs backs the slot picker before sign-in.
  -- ac_auth_subject is used by RLS policies (anon must be able to call it,
  -- otherwise a policy expression that calls it raises an error on anon queries
  -- instead of quietly returning false).
  -- ac_ensure_customer is service_role only — granted separately below.
  foreach fn in array array[
    'get_availability_inputs(uuid, timestamptz, timestamptz)',
    'ac_auth_subject()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public', fn);
      execute format('grant  execute on function %s to anon, authenticated, service_role', fn);
    end if;
  end loop;
end
$$;

do $$
begin
  -- ac_ensure_customer is called only by the server after verifying the Clerk
  -- session. It can adopt records by email, so authenticated must not call it.
  if to_regprocedure('ac_ensure_customer(text, text, text, text)') is not null then
    revoke execute on function ac_ensure_customer(text, text, text, text)
      from public, anon, authenticated;
    grant  execute on function ac_ensure_customer(text, text, text, text)
      to service_role;
  end if;
end
$$;
