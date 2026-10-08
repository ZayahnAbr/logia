-- ============================================================
-- StudySpace migration 15 — pricing waitlist, invite-a-friend credits
-- Run this in the Supabase SQL Editor.
--
-- Security model: users can READ their own credit balance and referral code, but can
-- never write them directly. All changes go through SECURITY DEFINER functions that
-- enforce the rules (no self-referral, one referral per account, new accounts only,
-- balances can only be spent, never topped up by the client).
-- ============================================================

-- ── Waitlist for the paid (unlimited) plan ──
create table if not exists waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  user_id    uuid        references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists waitlist_email_key on waitlist (lower(email));
alter table waitlist enable row level security;
-- Anyone may join; nobody can list the waitlist from the client.
drop policy if exists "waitlist join" on waitlist;
create policy "waitlist join" on waitlist for insert to anon, authenticated with check (true);

-- ── Bonus AI credits (tokens usable after the hourly limit) ──
create table if not exists ai_credits (
  user_id    uuid        primary key references profiles (id) on delete cascade,
  balance    int         not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table ai_credits enable row level security;
drop policy if exists "credits read own" on ai_credits;
create policy "credits read own" on ai_credits for select using (user_id = auth.uid());

-- ── Referral codes + who referred whom ──
create table if not exists referral_codes (
  user_id uuid primary key references profiles (id) on delete cascade,
  code    text not null unique
);
alter table referral_codes enable row level security;
drop policy if exists "codes read own" on referral_codes;
create policy "codes read own" on referral_codes for select using (user_id = auth.uid());

create table if not exists referrals (
  referred_id uuid        primary key references profiles (id) on delete cascade,  -- one referral per account
  referrer_id uuid        not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (referred_id <> referrer_id)
);
alter table referrals enable row level security;
drop policy if exists "referrals read own" on referrals;
create policy "referrals read own" on referrals for select using (referrer_id = auth.uid() or referred_id = auth.uid());

-- Returns (creating if needed) the caller's invite code.
create or replace function get_my_referral_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select code into c from referral_codes where user_id = auth.uid();
  if c is null then
    loop
      c := lower(substr(md5(gen_random_uuid()::text), 1, 8));
      begin
        insert into referral_codes (user_id, code) values (auth.uid(), c);
        exit;
      exception when unique_violation then -- retry with a new code
      end;
    end loop;
  end if;
  return c;
end $$;

-- Redeems an invite code for the caller. Both people get 50,000 bonus tokens.
-- Rules: valid code, not your own, account created in the last 14 days, once per account,
-- and a referrer earns rewards for at most 25 friends.
create or replace function claim_referral(invite_code text) returns text
language plpgsql security definer set search_path = public as $$
declare ref_owner uuid; joined timestamptz; reward int := 50000;
begin
  if auth.uid() is null then return 'not_signed_in'; end if;
  select user_id into ref_owner from referral_codes where code = lower(trim(invite_code));
  if ref_owner is null then return 'invalid'; end if;
  if ref_owner = auth.uid() then return 'own_code'; end if;
  if exists (select 1 from referrals where referred_id = auth.uid()) then return 'already_claimed'; end if;
  select created_at into joined from auth.users where id = auth.uid();
  if joined < now() - interval '14 days' then return 'too_old'; end if;

  insert into referrals (referred_id, referrer_id) values (auth.uid(), ref_owner);
  insert into ai_credits (user_id, balance) values (auth.uid(), reward)
    on conflict (user_id) do update set balance = ai_credits.balance + reward, updated_at = now();
  if (select count(*) from referrals where referrer_id = ref_owner) <= 25 then
    insert into ai_credits (user_id, balance) values (ref_owner, reward)
      on conflict (user_id) do update set balance = ai_credits.balance + reward, updated_at = now();
  end if;
  return 'ok';
end $$;

-- Records AI usage for the caller; anything over the hourly cap is paid from bonus credits.
create or replace function record_usage(used_tokens int) returns void
language plpgsql security definer set search_path = public as $$
declare hour_total int; cap int := 20000; overflow int;
begin
  if auth.uid() is null or used_tokens <= 0 then return; end if;
  insert into llm_usage (user_id, tokens) values (auth.uid(), used_tokens);
  select coalesce(sum(tokens), 0) into hour_total from llm_usage where user_id = auth.uid() and created_at > now() - interval '1 hour';
  overflow := least(used_tokens, greatest(0, hour_total - cap));
  if overflow > 0 then
    update ai_credits set balance = greatest(0, balance - overflow), updated_at = now() where user_id = auth.uid();
  end if;
end $$;

revoke all on function get_my_referral_code() from public, anon;
revoke all on function claim_referral(text)    from public, anon;
revoke all on function record_usage(int)       from public, anon;
grant execute on function get_my_referral_code() to authenticated;
grant execute on function claim_referral(text)    to authenticated;
grant execute on function record_usage(int)       to authenticated;
