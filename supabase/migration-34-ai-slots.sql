-- Migration 34: shared AI provider rate limiter (safe to re-run).
-- One row per provider holds a per-minute and a per-UTC-day counter. take_ai_slot() reserves a
-- request atomically (row lock) or says how long to wait. No direct table access for users.

create table if not exists public.ai_slots (
  provider text primary key,
  window_start timestamptz not null default now(),
  minute_requests int not null default 0,
  minute_tokens int not null default 0,
  day_start date not null default (now() at time zone 'utc')::date,
  day_requests int not null default 0,
  day_tokens int not null default 0
);

alter table public.ai_slots enable row level security;
-- Intentionally no policies: only the SECURITY DEFINER functions below touch the table.
revoke all on public.ai_slots from anon, authenticated;

create or replace function public.take_ai_slot(p_provider text, p_est_tokens int, p_rpm int, p_tpm int, p_tpd int, p_rpd int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ai_slots;
  now_ts timestamptz := now();
  today date := (now() at time zone 'utc')::date;
  est int := greatest(coalesce(p_est_tokens, 0), 0);
  wait_ms int;
begin
  insert into public.ai_slots (provider, window_start, day_start)
  values (p_provider, now_ts, today)
  on conflict (provider) do nothing;

  select * into r from public.ai_slots where provider = p_provider for update;

  if now_ts - r.window_start >= interval '60 seconds' then
    r.window_start := now_ts; r.minute_requests := 0; r.minute_tokens := 0;
  end if;
  if r.day_start < today then
    r.day_start := today; r.day_requests := 0; r.day_tokens := 0;
  end if;

  wait_ms := greatest(0, ceil(extract(epoch from (r.window_start + interval '60 seconds' - now_ts)) * 1000)::int);

  if p_rpm > 0 and r.minute_requests + 1 > p_rpm then
    update public.ai_slots set window_start = r.window_start, minute_requests = r.minute_requests, minute_tokens = r.minute_tokens,
      day_start = r.day_start, day_requests = r.day_requests, day_tokens = r.day_tokens where provider = p_provider;
    return jsonb_build_object('ok', false, 'retry_ms', wait_ms, 'reason', 'rpm');
  end if;
  if p_tpm > 0 and r.minute_tokens + est > p_tpm then
    update public.ai_slots set window_start = r.window_start, minute_requests = r.minute_requests, minute_tokens = r.minute_tokens,
      day_start = r.day_start, day_requests = r.day_requests, day_tokens = r.day_tokens where provider = p_provider;
    return jsonb_build_object('ok', false, 'retry_ms', wait_ms, 'reason', 'tpm');
  end if;
  if p_tpd > 0 and r.day_tokens + est > p_tpd then
    update public.ai_slots set window_start = r.window_start, minute_requests = r.minute_requests, minute_tokens = r.minute_tokens,
      day_start = r.day_start, day_requests = r.day_requests, day_tokens = r.day_tokens where provider = p_provider;
    return jsonb_build_object('ok', false, 'retry_ms', 3600000, 'reason', 'tpd');
  end if;
  if p_rpd > 0 and r.day_requests + 1 > p_rpd then
    update public.ai_slots set window_start = r.window_start, minute_requests = r.minute_requests, minute_tokens = r.minute_tokens,
      day_start = r.day_start, day_requests = r.day_requests, day_tokens = r.day_tokens where provider = p_provider;
    return jsonb_build_object('ok', false, 'retry_ms', 3600000, 'reason', 'rpd');
  end if;

  update public.ai_slots set
    window_start = r.window_start,
    minute_requests = r.minute_requests + 1,
    minute_tokens = r.minute_tokens + est,
    day_start = r.day_start,
    day_requests = r.day_requests + 1,
    day_tokens = r.day_tokens + est
  where provider = p_provider;

  return jsonb_build_object('ok', true, 'retry_ms', 0, 'reason', null);
end;
$$;

-- Corrects the estimate once real usage is known (delta may be negative).
create or replace function public.record_ai_actual(p_provider text, p_delta_tokens int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_slots set
    minute_tokens = greatest(0, minute_tokens + coalesce(p_delta_tokens, 0)),
    day_tokens = greatest(0, day_tokens + coalesce(p_delta_tokens, 0))
  where provider = p_provider;
end;
$$;

-- Read-only usage snapshot for a future admin page (counts only, no secrets).
create or replace function public.ai_slots_status()
returns table (provider text, window_start timestamptz, minute_requests int, minute_tokens int, day_start date, day_requests int, day_tokens int)
language sql
security definer
set search_path = public
as $$
  select provider, window_start, minute_requests, minute_tokens, day_start, day_requests, day_tokens from public.ai_slots order by provider;
$$;

grant execute on function public.take_ai_slot(text, int, int, int, int, int) to authenticated, anon;
grant execute on function public.record_ai_actual(text, int) to authenticated, anon;
grant execute on function public.ai_slots_status() to authenticated;

-- Pacing (same migration): per-hour pooled spend for today, in Africa/Johannesburg time.
create table if not exists public.ai_pace (
  day date not null,
  hour int not null,
  tokens int not null default 0,
  requests int not null default 0,
  primary key (day, hour)
);
alter table public.ai_pace enable row level security;
revoke all on public.ai_pace from anon, authenticated;

create or replace function public.ai_pace_add(p_tokens int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  local_ts timestamp := now() at time zone 'Africa/Johannesburg';
begin
  insert into public.ai_pace (day, hour, tokens, requests)
  values (local_ts::date, extract(hour from local_ts)::int, greatest(coalesce(p_tokens, 0), 0), 1)
  on conflict (day, hour) do update
    set tokens = greatest(0, public.ai_pace.tokens + coalesce(p_tokens, 0)), requests = public.ai_pace.requests + 1;
end;
$$;

-- Today's per-hour spend (counts only), for the pacer and the future admin page.
create or replace function public.ai_pace_status()
returns table (hour int, tokens int, requests int)
language sql
security definer
set search_path = public
as $$
  select hour, tokens, requests from public.ai_pace
  where day = (now() at time zone 'Africa/Johannesburg')::date order by hour;
$$;

grant execute on function public.ai_pace_add(int) to authenticated, anon;
grant execute on function public.ai_pace_status() to authenticated, anon;
