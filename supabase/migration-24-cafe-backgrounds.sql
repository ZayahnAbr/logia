-- ============================================================
-- Logia migration 24: picture and solid-colour backgrounds for hosted rooms
-- Requires migration 23. Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- loop_kind: preset loop, uploaded video, uploaded picture, or a plain colour.
-- loop_path holds the file for both 'upload' (video) and 'image'.
alter table user_cafes drop constraint if exists user_cafes_loop_kind_check;
alter table user_cafes add constraint user_cafes_loop_kind_check
  check (loop_kind in ('preset', 'upload', 'image', 'color'));

alter table user_cafes add column if not exists bg_color text;
alter table user_cafes drop constraint if exists user_cafes_bg_color_check;
alter table user_cafes add constraint user_cafes_bg_color_check
  check (bg_color is null or bg_color ~ '^#[0-9a-fA-F]{6}$');

-- The own-folder rule on loop_path (from migration 23) still applies to pictures.

-- Changing the background of a listed room sends it back for review.
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
     (new.loop_path is distinct from old.loop_path or new.loop_kind is distinct from old.loop_kind
      or new.bg_color is distinct from old.bg_color
      or new.music_path is distinct from old.music_path
      or new.music_url is distinct from old.music_url or new.name is distinct from old.name
      or new.description is distinct from old.description) then
    new.status := 'pending';
  end if;
  return new;
end $$;
drop trigger if exists user_cafes_guard_trg on user_cafes;
create trigger user_cafes_guard_trg before insert or update on user_cafes
  for each row execute function user_cafes_guard();

-- Storage: allow pictures next to the existing video and audio types. Limit stays 60 MB
-- (the app itself caps pictures at 10 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cafe-media', 'cafe-media', false, 62914560,
        array['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav',
              'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 62914560,
  allowed_mime_types = array['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav',
                             'image/jpeg', 'image/png', 'image/webp'];
