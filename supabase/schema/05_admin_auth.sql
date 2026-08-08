-- =============================================================================
-- AlongCo — 05_admin_auth.sql
--
-- Admin login rate limiting.
-- Admin sign-in is Supabase email + password, a different credential class from
-- the customer's Clerk session. Keeping them separate means a customer holding
-- a Clerk token carries a credential the admin surface has never heard of.
--
-- Nothing reversible is stored: email and IP are salted SHA-256 hashes created
-- server-side. The raw values never touch the database.
-- =============================================================================


-- =============================================================================
-- CONSUME ATTEMPT — check before trying the password
-- Counts only FAILED attempts so an admin who signs in correctly is never
-- locked out by their own history.
-- Uses ordered advisory locks (email lock < ip lock) to prevent deadlocks under
-- concurrent login attempts.
-- =============================================================================

create or replace function ac_consume_admin_login_attempt(
  p_email_hash text,
  p_ip_hash    text
)
returns table (allowed boolean, retry_after_seconds integer, scope text)
language plpgsql volatile
set search_path = public
as $$
declare
  v_email_fails integer;
  v_ip_fails    integer;
  v_email_lock  text := 'admin-login-email:' || p_email_hash;
  v_ip_lock     text := 'admin-login-ip:' || p_ip_hash;
begin
  if p_email_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AC_INVALID_RATE_LIMIT_KEY';
  end if;

  -- Consistent lock order prevents deadlock when two concurrent requests share
  -- one key but differ on the other.
  if v_email_lock < v_ip_lock then
    perform pg_advisory_xact_lock(hashtextextended(v_email_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_email_lock, 0));
  end if;

  select count(*) into v_email_fails
    from admin_login_attempts
   where email_hash  = p_email_hash
     and not succeeded
     and attempted_at >= now() - interval '15 minutes';

  if v_email_fails >= 5 then
    return query select false, 900, 'email'::text;
    return;
  end if;

  select count(*) into v_ip_fails
    from admin_login_attempts
   where ip_hash    = p_ip_hash
     and not succeeded
     and attempted_at >= now() - interval '15 minutes';

  if v_ip_fails >= 15 then
    return query select false, 900, 'ip'::text;
    return;
  end if;

  return query select true, 0, null::text;
end;
$$;

revoke all on function ac_consume_admin_login_attempt(text, text)
  from public, anon, authenticated;
grant  execute on function ac_consume_admin_login_attempt(text, text) to service_role;


-- =============================================================================
-- RECORD ATTEMPT — call after the sign-in attempt completes
-- Inserts the outcome and cleans up rows older than 7 days in the same
-- transaction, keeping the table small without a separate cron job.
-- =============================================================================

create or replace function ac_record_admin_login_attempt(
  p_email_hash text,
  p_ip_hash    text,
  p_succeeded  boolean
)
returns void
language plpgsql volatile
set search_path = public
as $$
begin
  if p_email_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AC_INVALID_RATE_LIMIT_KEY';
  end if;

  insert into admin_login_attempts (email_hash, ip_hash, succeeded)
  values (p_email_hash, p_ip_hash, p_succeeded);

  -- Inline cleanup: hashes are useless after the window.
  delete from admin_login_attempts
   where attempted_at < now() - interval '7 days';
end;
$$;

revoke all on function ac_record_admin_login_attempt(text, text, boolean)
  from public, anon, authenticated;
grant  execute on function ac_record_admin_login_attempt(text, text, boolean)
  to service_role;
