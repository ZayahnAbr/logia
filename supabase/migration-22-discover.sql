-- ============================================================
-- Logia migration 22: Discover (live cafes, study-with-me, public spaces, reports)
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- Admin check from the caller's JWT email (same two admins as lib/server/admin.ts).
create or replace function is_logia_admin() returns boolean
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('zayahnabrahams1@gmail.com', 'zayahnabrahams2004@gmail.com');
$$;

-- ── Live rooms (cafes) ────────────────────────────────────────
create table if not exists public_rooms (
  id             uuid        primary key default gen_random_uuid(),
  slug           text        not null unique,
  name           text        not null,
  scene          text        not null check (scene in ('rain-cafe', 'night-library', 'forest-cabin', 'lofi-desk')),
  focus_minutes  int         not null default 25 check (focus_minutes between 5 and 120),
  break_minutes  int         not null default 5  check (break_minutes between 1 and 60),
  anchor         timestamptz not null default now(),
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now()
);
alter table public_rooms enable row level security;
drop policy if exists "public_rooms read" on public_rooms;
create policy "public_rooms read" on public_rooms for select to authenticated using (true);

-- Fixed anchor so cycles line up with the clock (:00 / :30 for 25+5, on the hour for 50+10 and 45+15).
insert into public_rooms (slug, name, scene, focus_minutes, break_minutes, anchor) values
  ('rainy-cafe',    'Rainy café',    'rain-cafe',     25, 5,  timestamptz '2024-01-01 00:00:00+00'),
  ('night-library', 'Night library', 'night-library', 50, 10, timestamptz '2024-01-01 00:00:00+00'),
  ('forest-cabin',  'Forest cabin',  'forest-cabin',  25, 5,  timestamptz '2024-01-01 00:00:00+00'),
  ('lofi-desk',     'Lo-fi desk',    'lofi-desk',     45, 15, timestamptz '2024-01-01 00:00:00+00')
on conflict (slug) do nothing;

-- Same rule as lib/cafeClock.ts: position in the cycle = (now - anchor) mod (focus + break).
create or replace function cafe_phase(p_room_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when (((extract(epoch from (now() - r.anchor)))::numeric % ((r.focus_minutes + r.break_minutes) * 60)) + ((r.focus_minutes + r.break_minutes) * 60))
         % ((r.focus_minutes + r.break_minutes) * 60) < r.focus_minutes * 60
    then 'focus' else 'break' end
  from public_rooms r where r.id = p_room_id;
$$;
grant execute on function cafe_phase(uuid) to authenticated;

-- ── Cafe chat ─────────────────────────────────────────────────
create table if not exists cafe_messages (
  id            uuid        primary key default gen_random_uuid(),
  room_id       uuid        not null references public_rooms (id) on delete cascade,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  author        text        not null,
  author_color  text,
  author_icon   text,
  body          text        not null check (char_length(body) between 1 and 280),
  created_at    timestamptz not null default now(),
  hidden        boolean     not null default false
);
create index if not exists cafe_messages_room on cafe_messages (room_id, created_at desc);
create index if not exists cafe_messages_user on cafe_messages (user_id, created_at desc);

-- Chat is only open on a break, with 5 seconds between messages per person.
create or replace function cafe_can_post(p_room_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cafe_phase(p_room_id) = 'break'
     and not exists (select 1 from cafe_messages m where m.user_id = p_user_id and m.created_at > now() - interval '5 seconds');
$$;
grant execute on function cafe_can_post(uuid, uuid) to authenticated;

alter table cafe_messages enable row level security;
drop policy if exists "cafe_messages read" on cafe_messages;
create policy "cafe_messages read" on cafe_messages for select to authenticated
  using (hidden = false and created_at > now() - interval '24 hours');
drop policy if exists "cafe_messages admin read" on cafe_messages;
create policy "cafe_messages admin read" on cafe_messages for select to authenticated using (is_logia_admin());
drop policy if exists "cafe_messages send" on cafe_messages;
create policy "cafe_messages send" on cafe_messages for insert to authenticated
  with check (user_id = auth.uid() and cafe_can_post(room_id, auth.uid()));
drop policy if exists "cafe_messages admin update" on cafe_messages;
create policy "cafe_messages admin update" on cafe_messages for update to authenticated
  using (is_logia_admin()) with check (is_logia_admin());

do $$ begin
  alter publication supabase_realtime add table cafe_messages;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- ── Study with me (admin-curated) ─────────────────────────────
create table if not exists study_streams (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null check (char_length(title) between 1 and 140),
  channel     text        not null default '' check (char_length(channel) <= 80),
  youtube_id  text        not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  kind        text        not null default 'video' check (kind in ('live', 'video')),
  is_active   boolean     not null default true,
  sort        int         not null default 0,
  created_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table study_streams enable row level security;
drop policy if exists "study_streams read" on study_streams;
create policy "study_streams read" on study_streams for select to authenticated using (is_active or is_logia_admin());
drop policy if exists "study_streams admin write" on study_streams;
create policy "study_streams admin write" on study_streams for all to authenticated
  using (is_logia_admin()) with check (is_logia_admin());

-- ── Public spaces ─────────────────────────────────────────────
alter table spaces add column if not exists is_public boolean not null default false;
alter table spaces add column if not exists public_description text;
alter table spaces add column if not exists hidden boolean not null default false;

-- The member table isn't defined in these migrations, so find it: a table with space_id + user_id and "member" in its name.
create or replace function list_public_spaces()
returns table (id uuid, name text, subject text, public_description text, member_count bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare mt text;
begin
  if auth.uid() is null then return; end if;
  select c.table_name into mt
    from information_schema.columns c
    join information_schema.columns u on u.table_schema = c.table_schema and u.table_name = c.table_name and u.column_name = 'user_id'
   where c.table_schema = 'public' and c.column_name = 'space_id' and c.table_name ilike '%member%'
   order by (c.table_name = 'space_members') desc limit 1;
  if mt is null then
    return query select s.id, s.name, s.subject, s.public_description, 1::bigint, s.created_at
      from spaces s where s.is_public and not s.hidden order by s.created_at desc;
  else
    return query execute format(
      'select s.id, s.name, s.subject, s.public_description,
              (select count(*) from %I m where m.space_id = s.id)::bigint, s.created_at
         from spaces s where s.is_public and not s.hidden order by s.created_at desc', mt);
  end if;
end $$;
grant execute on function list_public_spaces() to authenticated;

-- Joins by reusing join_space_by_code so membership is inserted exactly as it is today.
create or replace function join_public_space(p_space_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select s.invite_code into code from spaces s where s.id = p_space_id and s.is_public and not s.hidden;
  if code is null then raise exception 'This space is not open to join.'; end if;
  return join_space_by_code(code);
end $$;
grant execute on function join_public_space(uuid) to authenticated;

-- Only the creator can publish or unpublish their space.
create or replace function set_space_public(p_space_id uuid, p_public boolean, p_description text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update spaces set is_public = p_public, public_description = nullif(left(trim(coalesce(p_description, '')), 280), '')
   where id = p_space_id and created_by = auth.uid();
  if not found then raise exception 'Only the creator of a space can change this.'; end if;
end $$;
grant execute on function set_space_public(uuid, boolean, text) to authenticated;

-- Admins can't see spaces they aren't in (RLS), so moderation goes through these.
create or replace function admin_spaces_brief(p_ids uuid[])
returns table (id uuid, name text, subject text, public_description text, is_public boolean, hidden boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  return query select s.id, s.name, s.subject, s.public_description, s.is_public, s.hidden from spaces s where s.id = any(p_ids);
end $$;
grant execute on function admin_spaces_brief(uuid[]) to authenticated;

create or replace function admin_hide_space(p_space_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  update spaces set hidden = true where id = p_space_id;
end $$;
grant execute on function admin_hide_space(uuid) to authenticated;

-- ── Reports ───────────────────────────────────────────────────
create table if not exists content_reports (
  id           uuid        primary key default gen_random_uuid(),
  reporter_id  uuid        not null references auth.users (id) on delete cascade,
  kind         text        not null check (kind in ('cafe_message', 'space', 'stream')),
  target_id    uuid        not null,
  reason       text        not null default '' check (char_length(reason) <= 500),
  status       text        not null default 'open' check (status in ('open', 'resolved')),
  created_at   timestamptz not null default now()
);
create index if not exists content_reports_open on content_reports (status, created_at desc);
alter table content_reports enable row level security;
drop policy if exists "reports insert" on content_reports;
create policy "reports insert" on content_reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "reports admin read" on content_reports;
create policy "reports admin read" on content_reports for select to authenticated using (is_logia_admin());
drop policy if exists "reports admin update" on content_reports;
create policy "reports admin update" on content_reports for update to authenticated
  using (is_logia_admin()) with check (is_logia_admin());
