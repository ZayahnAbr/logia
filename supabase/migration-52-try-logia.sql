-- Migration 52: lets a visitor try Logia on the landing page before signing in — drop in a file or
-- paste text and get notes, flashcards or a transcript back, with nothing saved and no account needed.
-- Self-contained: no foreign keys to profiles/auth.users, so it carries no risk to existing data or RLS.
-- Rate-limited by a hash of the visitor's IP address (never the raw IP) through a definer function,
-- so it works for a signed-out visitor with only the public anon key. Safe to re-run.

create table if not exists anon_trials (
  id         uuid        primary key default gen_random_uuid(),
  ip_hash    text        not null,
  kind       text        not null default 'generate',
  created_at timestamptz not null default now()
);
create index if not exists anon_trials_ip_time on anon_trials (ip_hash, created_at);

alter table anon_trials enable row level security;
-- No row-level policies: nothing reads or writes this table directly, only anon_trial_try() below.

-- Returns true and logs an attempt if the visitor is still under the limit, false if not.
-- p_window_hours as a parameter (not hard-coded) so the limit can be tuned without a new migration.
create or replace function anon_trial_try(p_ip_hash text, p_kind text default 'generate', p_max int default 3, p_window_hours int default 24)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_ip_hash is null or length(p_ip_hash) = 0 then return false; end if;
  select count(*) into n from anon_trials where ip_hash = p_ip_hash and created_at > now() - (p_window_hours || ' hours')::interval;
  if n >= p_max then return false; end if;
  insert into anon_trials (ip_hash, kind) values (p_ip_hash, p_kind);
  return true;
end $$;
grant execute on function anon_trial_try(text, text, int, int) to anon, authenticated;

-- Housekeeping: old rows are of no use once the window they could affect has passed. Harmless to
-- run by hand in the SQL editor occasionally; not scheduled automatically.
create or replace function anon_trials_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from anon_trials where created_at < now() - interval '7 days';
$$;
grant execute on function anon_trials_cleanup() to authenticated;
