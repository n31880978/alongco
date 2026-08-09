-- Public booking hardening.  The booking form has no customer login, so every
-- anonymous mutation must be throttled server-side; in-memory limits do not
-- survive serverless instances and are not a security control.

create table if not exists public.public_action_limits (
  scope text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  primary key (scope, subject_hash)
);

alter table public.public_action_limits enable row level security;
alter table public.public_action_limits force row level security;

create or replace function public.ac_consume_public_action_limit(
  p_scope text,
  p_subject_hash text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public_action_limits%rowtype;
begin
  if p_scope !~ '^[a-z_]{1,64}$'
     or p_subject_hash !~ '^[a-f0-9]{64}$'
     or p_max_attempts < 1
     or p_window_seconds < 1 then
    raise exception 'AC_RATE_LIMIT_INPUT_INVALID';
  end if;

  select * into v_row from public_action_limits
   where scope = p_scope and subject_hash = p_subject_hash
   for update;

  if not found then
    insert into public_action_limits(scope, subject_hash, window_started_at, attempts)
    values (p_scope, p_subject_hash, now(), 1);
    return true;
  end if;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= now() then
    update public_action_limits
       set window_started_at = now(), attempts = 1
     where scope = p_scope and subject_hash = p_subject_hash;
    return true;
  end if;

  if v_row.attempts >= p_max_attempts then
    return false;
  end if;

  update public_action_limits
     set attempts = attempts + 1
   where scope = p_scope and subject_hash = p_subject_hash;
  return true;
end;
$$;

revoke all on table public.public_action_limits from public, anon, authenticated;
revoke execute on function public.ac_consume_public_action_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ac_consume_public_action_limit(text, text, integer, integer)
  to service_role;

-- Email is not proof of ownership. Remove the anonymous account-recovery API:
-- it disclosed a person’s bookings to anyone who knew her email address.
revoke execute on function public.list_bookings_by_email(text)
  from public, anon, authenticated;
