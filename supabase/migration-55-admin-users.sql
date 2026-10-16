-- ============================================================
-- Logia migration 55: admin user list (sign-ups and plans)
-- Run in the Supabase SQL Editor. Safe to re-run. Requires migration 35 (plans, is_logia_admin).
-- Admin only: the function checks is_logia_admin() itself.
-- ============================================================

create or replace function admin_list_users(p_limit int default 1000)
returns table (user_id uuid, email text, display_name text, signed_up timestamptz, last_sign_in timestamptz,
               plan text, plan_until timestamptz, plan_source text, effective_plan text, onboarded boolean, banned boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  return query
    select u.id, u.email::text, p.display_name::text, u.created_at, u.last_sign_in_at,
           p.plan, p.plan_until, p.plan_source,
           case when p.plan = 'pro' and (p.plan_until is null or p.plan_until <= now()) then 'free' else p.plan end,
           coalesce(p.onboarding_completed, false), coalesce(p.banned, false)
      from auth.users u
      left join profiles p on p.id = u.id
     order by u.created_at desc
     limit greatest(1, least(coalesce(p_limit, 1000), 5000));
end $$;
grant execute on function admin_list_users(int) to authenticated;
