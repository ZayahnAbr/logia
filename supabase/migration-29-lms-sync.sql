-- ============================================================
-- Logia migration 29: school sync (deadlines from Brightspace, Canvas, Moodle, Blackboard via the browser extension, and Google Classroom via sign-in)
-- Run in the Supabase SQL Editor. Safe to re-run. No other migration is required.
--
-- lms_connections: one row per connection code. Only the sha256 hash of the code is stored,
--                  the code itself is shown once in Settings and never saved.
-- lms_items:       read-only deadlines pushed by the extension (upserted by source_id).
-- lms_sync():      SECURITY DEFINER function the /api/lms/sync route calls with the code.
--                  The app has no service-role key, so this function is the only write path.
-- ============================================================

create table if not exists lms_connections (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid() references profiles (id) on delete cascade,
  token_hash   text        not null unique,
  label        text        not null default 'School sync' check (char_length(label) <= 60),
  school_origin text       check (school_origin is null or school_origin ~ '^https://[^/]+$'),  -- fixed by the first sync; item links must match it
  platform     text        check (platform is null or platform in ('brightspace', 'canvas', 'moodle', 'blackboard', 'google_classroom')),  -- set by the first sync that names one
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table lms_connections add column if not exists school_origin text;
alter table lms_connections add column if not exists platform text;
create index if not exists lms_connections_user on lms_connections (user_id, created_at desc);

create table if not exists lms_items (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references profiles (id) on delete cascade,
  source      text        not null default 'brightspace' check (char_length(source) <= 30),
  source_id   text        not null check (char_length(source_id) between 1 and 200),
  title       text        not null check (char_length(title) between 1 and 300),
  course      text        not null default '' check (char_length(course) <= 200),
  course_code text        not null default '' check (char_length(course_code) <= 40),
  item_type   text        not null default 'other' check (item_type in ('assignment', 'quiz', 'discussion', 'checklist', 'event', 'other')),
  due_at      timestamptz,
  url         text        not null default '' check (char_length(url) <= 600),
  completed   boolean     not null default false,
  removed_at  timestamptz,                       -- set when a later full sync no longer lists the item
  synced_at   timestamptz not null default now(),
  unique (user_id, source, source_id)
);
create index if not exists lms_items_user_due on lms_items (user_id, due_at);

alter table lms_connections enable row level security;
drop policy if exists "lms_connections self" on lms_connections;
create policy "lms_connections self" on lms_connections for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table lms_items enable row level security;
drop policy if exists "lms_items read own" on lms_items;
create policy "lms_items read own" on lms_items for select to authenticated using (user_id = auth.uid());
drop policy if exists "lms_items delete own" on lms_items;
create policy "lms_items delete own" on lms_items for delete to authenticated using (user_id = auth.uid());
-- Extension platforms have no insert/update policy on purpose: those rows are written only by lms_sync() below.
-- Google Classroom is synced by the app on the signed-in user's own behalf, so users may write their own
-- google_classroom rows (and only those, with links on classroom.google.com).
drop policy if exists "lms_items classroom insert" on lms_items;
create policy "lms_items classroom insert" on lms_items for insert to authenticated
  with check (user_id = auth.uid() and source = 'google_classroom' and (url = '' or url like 'https://classroom.google.com/%'));
drop policy if exists "lms_items classroom update" on lms_items;
create policy "lms_items classroom update" on lms_items for update to authenticated
  using (user_id = auth.uid() and source = 'google_classroom')
  with check (user_id = auth.uid() and source = 'google_classroom' and (url = '' or url like 'https://classroom.google.com/%'));

-- ------------------------------------------------------------
-- lms_sync(p_token, p_items, p_window_start, p_window_end)
--   p_items         jsonb array, max 500. Unknown keys are ignored, invalid rows are skipped.
--   p_window_*      only when the extension sent every item it found. Items of this source whose
--                   due date is inside the window but that were not in p_items are marked removed.
-- Returns {"ok": true, "count": n}. Raises 'invalid_token' for an unknown or revoked code.
-- ------------------------------------------------------------
drop function if exists lms_sync(text, jsonb, timestamptz, timestamptz);
create or replace function lms_sync(
  p_token        text,
  p_items        jsonb,
  p_window_start timestamptz default null,
  p_window_end   timestamptz default null,
  p_origin       text default null,
  p_platform     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash    text;
  v_user    uuid;
  v_conn    uuid;
  v_now     timestamptz := now();
  it        jsonb;
  v_count   integer := 0;
  v_ids     text[] := '{}';
  v_sid     text;
  v_title   text;
  v_url     text;
  v_due     timestamptz;
  v_type    text;
  v_school  text;
  v_plat    text;
begin
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 200 then
    raise exception 'invalid_token' using errcode = '28000';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select id, user_id, school_origin, platform into v_conn, v_user, v_school, v_plat from lms_connections where token_hash = v_hash;
  if v_user is null then
    raise exception 'invalid_token' using errcode = '28000';
  end if;
  -- Extension platforms only. Google Classroom syncs from the app itself, not through this function.
  if p_platform is not null and p_platform not in ('brightspace', 'canvas', 'moodle', 'blackboard') then
    raise exception 'unsupported_platform' using errcode = '22023';
  end if;
  if p_platform is not null and v_plat is not null and v_plat <> p_platform then
    raise exception 'platform_mismatch' using errcode = '22023';
  end if;
  -- The school address is fixed by the first sync that names one. Item links must then match it.
  if v_school is null and p_origin ~ '^https://[^/]+$' and char_length(p_origin) <= 200 then
    v_school := lower(p_origin);
    update lms_connections set school_origin = v_school where id = v_conn;
  end if;
  if v_plat is null and p_platform is not null then
    v_plat := p_platform;
    update lms_connections set platform = v_plat where id = v_conn;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if v_plat is null and jsonb_array_length(p_items) > 0 then
    raise exception 'platform_required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      if jsonb_typeof(it) <> 'object' then continue; end if;
      v_sid   := left(btrim(coalesce(it->>'sourceId', '')), 200);
      v_title := left(btrim(coalesce(it->>'title', '')), 300);
      v_url   := coalesce(it->>'url', '');
      if v_sid = '' or v_title = '' then continue; end if;
      -- A link must be https and on the school's own origin; otherwise the item is rejected.
      if v_url <> '' and (v_school is null or v_url !~* '^https://' or lower('https://' || split_part(v_url, '/', 3)) <> v_school) then
        continue;
      end if;
      v_url := left(v_url, 600);
      v_due := nullif(it->>'dueAt', '')::timestamptz;
      v_type := coalesce(it->>'type', 'other');
      if v_type not in ('assignment', 'quiz', 'discussion', 'checklist', 'event', 'other') then v_type := 'other'; end if;

      insert into lms_items (user_id, source, source_id, title, course, course_code, item_type, due_at, url, completed, removed_at, synced_at)
      values (
        v_user, v_plat, v_sid, v_title,
        left(coalesce(it->>'course', ''), 200),
        left(coalesce(it->>'courseCode', ''), 40),
        v_type, v_due, v_url,
        coalesce((it->>'completed') = 'true', false),
        null, v_now
      )
      on conflict (user_id, source, source_id) do update set
        title = excluded.title, course = excluded.course, course_code = excluded.course_code,
        item_type = excluded.item_type, due_at = excluded.due_at, url = excluded.url,
        completed = excluded.completed, removed_at = null, synced_at = excluded.synced_at;
      v_ids := v_ids || v_sid;
      v_count := v_count + 1;
    exception when others then
      continue;  -- skip a malformed item, keep the rest
    end;
  end loop;

  if p_window_start is not null and p_window_end is not null and p_window_end > p_window_start then
    update lms_items set removed_at = v_now
    where user_id = v_user and source = v_plat and removed_at is null
      and due_at >= p_window_start and due_at <= p_window_end
      and not (source_id = any (v_ids));
  end if;

  update lms_connections set last_used_at = v_now where id = v_conn;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

revoke all on function lms_sync(text, jsonb, timestamptz, timestamptz, text, text) from public;
grant execute on function lms_sync(text, jsonb, timestamptz, timestamptz, text, text) to anon, authenticated;
