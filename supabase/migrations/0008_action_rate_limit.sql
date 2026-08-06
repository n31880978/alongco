-- AlongCo — 0008_action_rate_limit.sql
--
-- TASKS T21. OTP already has its own limiter (0006), which is keyed on hashes
-- because it runs before there is a session. Booking creation and review
-- submission both happen *after* authentication, so they can be limited per
-- customer, which is both simpler and harder to evade than an IP limit.
--
-- The counters are derived from the rows the actions already write — there is no
-- separate counter table to keep in step, and nothing new is retained about her.

create or replace function ac_check_action_rate_limit(
  p_action text,
  p_customer_id uuid
)
returns table (allowed boolean, retry_after_seconds integer, reason text)
language plpgsql volatile
set search_path = public
as $$
declare
  v_recent integer;
  v_lock text := 'ac-action:' || p_action || ':' || p_customer_id::text;
begin
  -- Serialize per customer per action, so two concurrent submissions cannot both
  -- read the same count and both slip through.
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

  if p_action = 'booking_hold' then
    -- Holds block a companion's slot for ten minutes. Someone cycling through
    -- holds without paying can take a whole day off the market, so the limit is
    -- on *unpaid* holds — paying for one and booking another is not abuse.
    select count(*) into v_recent
      from bookings
     where customer_id = p_customer_id
       and status in ('pending_payment', 'expired')
       and created_at >= now() - interval '1 hour';

    if v_recent >= 8 then
      return query select false, 3600,
        'Too many holds without payment. Try again in an hour, or call us and we will book it by hand.'::text;
      return;
    end if;

    select count(*) into v_recent
      from bookings
     where customer_id = p_customer_id
       and created_at >= now() - interval '1 minute';

    if v_recent >= 3 then
      return query select false, 60,
        'That was very quick. Wait a moment and try again.'::text;
      return;
    end if;

  elsif p_action = 'review' then
    -- One review per booking is already enforced by a unique constraint. This
    -- is about someone hammering the endpoint, not about duplicate reviews.
    select count(*) into v_recent
      from reviews
     where customer_id = p_customer_id
       and created_at >= now() - interval '1 hour';

    if v_recent >= 5 then
      return query select false, 3600,
        'You have left several reviews just now. Try again in an hour.'::text;
      return;
    end if;

  else
    raise exception 'AC_UNKNOWN_RATE_LIMIT_ACTION';
  end if;

  return query select true, 0, null::text;
end;
$$;

revoke all on function ac_check_action_rate_limit(text, uuid) from public, anon;
grant execute on function ac_check_action_rate_limit(text, uuid) to authenticated, service_role;
