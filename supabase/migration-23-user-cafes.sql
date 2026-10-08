-- ============================================================
-- Logia migration 23: user-hosted "study with me" rooms
-- Requires migration 22. Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ── Rooms ─────────────────────────────────────────────────────
create table if not exists user_cafes (
  id             uuid        primary key default gen_random_uuid(),
  owner_id       uuid        not null references profiles (id) on delete cascade,
  name           text        not null check (char_length(name) between 1 and 60),
  description    text        not null default '' check (char_length(description) <= 200),
  loop_kind      text        not null check (loop_kind in ('preset', 'upload')),
  loop_preset    text        check (loop_preset in ('rain-cafe', 'night-library', 'forest-cabin', 'lofi-desk')),
  loop_path      text,
  music_kind     text        not null default 'none' check (music_kind in ('none', 'link', 'upload')),
  music_url      text        check (music_url is null or char_length(music_url) <= 500),
  music_path     text,
  focus_minutes  int         not null default 25 check (focus_minutes between 5 and 120),
  break_minutes  int         not null default 5  check (break_minutes between 1 and 60),
  anchor         timestamptz not null default now(),
  status         text        not null default 'unlisted' check (status in ('unlisted', 'pending', 'public', 'hidden')),
  created_at     timestamptz not null default now(),
  -- uploaded files must live in the owner's own folder
  constraint user_cafes_loop_path_own check (loop_path is null or loop_path like owner_id::text || '/%'),
  constraint user_cafes_music_path_own check (music_path is null or music_path like owner_id::text || '/%')
);
create index if not exists user_cafes_owner on user_cafes (owner_id, created_at desc);
create index if not exists user_cafes_status on user_cafes (status, created_at desc);

alter table user_cafes enable row level security;
drop policy if exists "user_cafes owner all" on user_cafes;
create policy "user_cafes owner all" on user_cafes for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Unlisted rooms are reachable by link only: the app never lists them, but anyone with the id can open one.
drop policy if exists "user_cafes read shared" on user_cafes;
create policy "user_cafes read shared" on user_cafes for select to authenticated
  using (status in ('unlisted', 'public'));
drop policy if exists "user_cafes admin read" on user_cafes;
create policy "user_cafes admin read" on user_cafes for select to authenticated using (is_logia_admin());
drop policy if exists "user_cafes admin update" on user_cafes;
create policy "user_cafes admin update" on user_cafes for update to authenticated
  using (is_logia_admin()) with check (is_logia_admin());

-- Owners can never publish themselves: only an admin can set 'public' or 'hidden'.
-- Changing the loop or music of a listed room sends it back for review.
create or replace function user_cafes_guard() returns trigger
language plpgsql as $$
begin
  if is_logia_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('unlisted', 'pending') then new.status := 'unlisted'; end if;
    return new;
  end if;
  new.owner_id := old.owner_id;
  if old.status = 'hidden' then
    new.status := 'hidden';
  elsif new.status in ('public', 'hidden') and new.status <> old.status then
    new.status := old.status;
  end if;
  if old.status = 'public' and new.status = 'public' and
     (new.loop_path is distinct from old.loop_path or new.music_path is distinct from old.music_path
      or new.music_url is distinct from old.music_url or new.name is distinct from old.name
      or new.description is distinct from old.description) then
    new.status := 'pending';
  end if;
  return new;
end $$;
drop trigger if exists user_cafes_guard_trg on user_cafes;
create trigger user_cafes_guard_trg before insert or update on user_cafes
  for each row execute function user_cafes_guard();

-- Host names and avatars for cards (profiles may not be readable by everyone).
create or replace function user_cafe_hosts(p_ids uuid[])
returns table (id uuid, display_name text, avatar_color text, avatar_icon text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_color, p.avatar_icon from profiles p where p.id = any(p_ids);
$$;
grant execute on function user_cafe_hosts(uuid[]) to authenticated;

-- ── Phase, mirroring cafe_phase() ─────────────────────────────
create or replace function user_cafe_phase(p_cafe_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when (((extract(epoch from (now() - r.anchor)))::numeric % ((r.focus_minutes + r.break_minutes) * 60)) + ((r.focus_minutes + r.break_minutes) * 60))
         % ((r.focus_minutes + r.break_minutes) * 60) < r.focus_minutes * 60
    then 'focus' else 'break' end
  from user_cafes r where r.id = p_cafe_id;
$$;
grant execute on function user_cafe_phase(uuid) to authenticated;

-- ── Chat for both kinds of rooms ──────────────────────────────
alter table cafe_messages alter column room_id drop not null;
alter table cafe_messages add column if not exists cafe_id uuid references user_cafes (id) on delete cascade;
alter table cafe_messages drop constraint if exists cafe_messages_one_room;
alter table cafe_messages add constraint cafe_messages_one_room check ((room_id is null) <> (cafe_id is null));
create index if not exists cafe_messages_cafe on cafe_messages (cafe_id, created_at desc);

create or replace function user_cafe_can_post(p_cafe_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select user_cafe_phase(p_cafe_id) = 'break'
     and exists (select 1 from user_cafes c where c.id = p_cafe_id and (c.status in ('unlisted', 'public') or c.owner_id = p_user_id))
     and not exists (select 1 from cafe_messages m where m.user_id = p_user_id and m.created_at > now() - interval '5 seconds');
$$;
grant execute on function user_cafe_can_post(uuid, uuid) to authenticated;

drop policy if exists "cafe_messages send" on cafe_messages;
create policy "cafe_messages send" on cafe_messages for insert to authenticated
  with check (
    user_id = auth.uid() and (
      (room_id is not null and cafe_id is null and cafe_can_post(room_id, auth.uid()))
      or (cafe_id is not null and room_id is null and user_cafe_can_post(cafe_id, auth.uid()))
    )
  );

-- ── Reports can target rooms ──────────────────────────────────
alter table content_reports drop constraint if exists content_reports_kind_check;
alter table content_reports add constraint content_reports_kind_check
  check (kind in ('cafe_message', 'space', 'stream', 'user_cafe'));

-- ── Storage for uploaded loops and tracks ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cafe-media', 'cafe-media', false, 62914560,
        array['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav'])
on conflict (id) do update set public = false, file_size_limit = 62914560,
  allowed_mime_types = array['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav'];

drop policy if exists "cafe-media upload own" on storage.objects;
create policy "cafe-media upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'cafe-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "cafe-media delete own" on storage.objects;
create policy "cafe-media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'cafe-media' and ((storage.foldername(name))[1] = auth.uid()::text or is_logia_admin()));
-- Files are only handed out as short-lived signed URLs created on the server.
drop policy if exists "cafe-media read" on storage.objects;
create policy "cafe-media read" on storage.objects for select to authenticated
  using (bucket_id = 'cafe-media');
