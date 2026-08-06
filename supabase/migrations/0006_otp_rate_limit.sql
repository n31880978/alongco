-- AlongCo — 0006_otp_rate_limit.sql
--
-- The OTP request happens before a customer has a session. This narrowly scoped
-- RPC records only salted hashes and enforces the limits without granting the
-- browser (or the server action) direct access to otp_requests. It removes the
-- need for SUPABASE_SERVICE_ROLE_KEY in the sign-in flow.

create or replace function ac_consume_otp_rate_limit(
  p_phone_hash text,
  p_ip_hash    text
)
returns table (allowed boolean, retry_after_seconds integer, scope text)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_phone_lock text := 'otp-phone:' || p_phone_hash;
  v_ip_lock    text := 'otp-ip:' || p_ip_hash;
  v_minute_count integer;
  v_phone_hour_count integer;
  v_ip_hour_count integer;
begin
  -- The hashes are SHA-256 hex values created on the server with OTP_HASH_SALT.
  -- Reject arbitrary payloads before they can become retained data.
  if p_phone_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AC_INVALID_RATE_LIMIT_KEY';
  end if;

  -- Serialize requests that share either limiting key. Without these locks,
  -- concurrent sixth requests could both observe a count of four and slip past
  -- the limit before either one inserts its row.
  if v_phone_lock < v_ip_lock then
    perform pg_advisory_xact_lock(hashtextextended(v_phone_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_phone_lock, 0));
  end if;

  select count(*) into v_minute_count
    from otp_requests
   where phone_hash = p_phone_hash
     and requested_at >= now() - interval '1 minute';

  if v_minute_count >= 5 then
    return query select false, 60, 'phone';
    return;
  end if;

  select count(*) into v_phone_hour_count
    from otp_requests
   where phone_hash = p_phone_hash
     and requested_at >= now() - interval '1 hour';

  if v_phone_hour_count >= 10 then
    return query select false, 3600, 'phone';
    return;
  end if;

  select count(*) into v_ip_hour_count
    from otp_requests
   where ip_hash = p_ip_hash
     and requested_at >= now() - interval '1 hour';

  if v_ip_hour_count >= 20 then
    return query select false, 3600, 'ip';
    return;
  end if;

  insert into otp_requests (phone_hash, ip_hash) values (p_phone_hash, p_ip_hash);

  -- Hashes are not retained beyond the useful abuse-prevention window.
  delete from otp_requests where requested_at < now() - interval '24 hours';

  return query select true, 0, null::text;
end;
$$;

revoke all on function ac_consume_otp_rate_limit(text, text) from public;
grant execute on function ac_consume_otp_rate_limit(text, text) to anon, authenticated;
