-- AlongCo — 0010_admin_login.sql
--
-- Admin sign-in is email + password, deliberately a different credential class
-- from the customer's phone OTP. A password endpoint is guessable in a way an
-- OTP flow is not, so it gets its own throttle.
--
-- Nothing reversible is stored: the email and IP are salted SHA-256 hashes
-- created on the server, the same treatment OTP requests get (CLAUDE.md §9).

create table if not exists admin_login_attempts (
  id           uuid primary key default gen_random_uuid(),
  email_hash   text not null,
  ip_hash      text not null,
  succeeded    boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists admin_login_attempts_email_idx
  on admin_login_attempts (email_hash, attempted_at desc);
create index if not exists admin_login_attempts_ip_idx
  on admin_login_attempts (ip_hash, attempted_at desc);

alter table admin_login_attempts enable row level security;
-- No policy, deliberately. Only the service role touches this.

-- ---------------------------------------------------------------------------
-- Consume one attempt. Returns whether to proceed.
--
-- Counts only FAILED attempts in the window, so a working admin signing in
-- repeatedly is never locked out by their own success.
-- ---------------------------------------------------------------------------

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

  -- Ordered consistently so two concurrent attempts cannot deadlock.
  if v_email_lock < v_ip_lock then
    perform pg_advisory_xact_lock(hashtextextended(v_email_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_email_lock, 0));
  end if;

  select count(*) into v_email_fails
    from admin_login_attempts
   where email_hash = p_email_hash
     and not succeeded
     and attempted_at >= now() - interval '15 minutes';

  if v_email_fails >= 5 then
    return query select false, 900, 'email'::text;
    return;
  end if;

  select count(*) into v_ip_fails
    from admin_login_attempts
   where ip_hash = p_ip_hash
     and not succeeded
     and attempted_at >= now() - interval '15 minutes';

  if v_ip_fails >= 15 then
    return query select false, 900, 'ip'::text;
    return;
  end if;

  return query select true, 0, null::text;
end;
$$;

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

  -- Hashes are not kept beyond the useful window.
  delete from admin_login_attempts where attempted_at < now() - interval '7 days';
end;
$$;

revoke all on function ac_consume_admin_login_attempt(text, text) from public, anon, authenticated;
grant execute on function ac_consume_admin_login_attempt(text, text) to service_role;

revoke all on function ac_record_admin_login_attempt(text, text, boolean) from public, anon, authenticated;
grant execute on function ac_record_admin_login_attempt(text, text, boolean) to service_role;
