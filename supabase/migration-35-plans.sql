-- ============================================================
-- Logia migration 35: plans (free / pro / admin)
-- Run this in the Supabase SQL Editor. Safe to re-run. No dependencies.
-- ============================================================

-- Local copy of the admin check so this file has no dependency (same definition as migration 22).
create or replace function is_logia_admin() returns boolean
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('zayahnabrahams1@gmail.com', 'zayahnabrahams2004@gmail.com');
$$;

alter table profiles add column if not exists plan text not null default 'free';
alter table profiles add column if not exists plan_until timestamptz null;
alter table profiles add column if not exists plan_source text null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_plan_check') then
    alter table profiles add constraint profiles_plan_check check (plan in ('free', 'pro', 'admin'));
  end if;
end $$;

create index if not exists profiles_plan_idx on profiles (plan, plan_until);

-- A user can already read their own profile row (so they can read their own plan). They must never write
-- the plan columns, whatever their update policy allows: this trigger rejects any change by a non-admin.
-- set_user_plan() below runs for an admin, so it passes.
create or replace function guard_plan_columns() returns trigger
language plpgsql as $$
begin
  if (new.plan is distinct from old.plan or new.plan_until is distinct from old.plan_until or new.plan_source is distinct from old.plan_source)
     and not is_logia_admin() then
    raise exception 'Plans can only be changed by Logia';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_plan on profiles;
create trigger profiles_guard_plan before update on profiles for each row execute function guard_plan_columns();

-- Plan in force right now: an expired pro falls back to free with no cron job.
create or replace function effective_plan(p_user_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.plan = 'pro' and (p.plan_until is null or p.plan_until <= now()) then 'free'
    else p.plan
  end
  from profiles p where p.id = p_user_id
  union all select 'free' limit 1;
$$;
grant execute on function effective_plan(uuid) to authenticated;

-- Admin only: grant or revoke a plan. Pro needs an expiry in the future; free clears it.
create or replace function set_user_plan(p_user_id uuid, p_plan text, p_until timestamptz, p_source text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  if p_plan not in ('free', 'pro', 'admin') then raise exception 'Unknown plan'; end if;
  if p_plan = 'pro' and (p_until is null or p_until <= now()) then raise exception 'Pro needs an expiry date in the future'; end if;
  update profiles
     set plan = p_plan,
         plan_until = case when p_plan = 'free' then null else p_until end,
         plan_source = case when p_plan = 'free' then null else p_source end
   where id = p_user_id;
  if not found then raise exception 'No such user'; end if;
end $$;
grant execute on function set_user_plan(uuid, text, timestamptz, text) to authenticated;

-- Admin only: find a user by email for the Plans tool.
create or replace function admin_find_user(p_email text)
returns table (user_id uuid, email text, plan text, plan_until timestamptz, plan_source text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  return query
    select u.id, u.email::text, p.plan, p.plan_until, p.plan_source
      from auth.users u join profiles p on p.id = u.id
     where lower(u.email) = lower(trim(p_email));
end $$;
grant execute on function admin_find_user(text) to authenticated;
