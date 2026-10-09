-- ============================================================
-- Logia migration 42: covers for hosted rooms
-- Requires migrations 23 and 24. Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- cover_path: the flattened 1280x720 JPEG in the private cafe-media bucket, in the owner's own folder.
-- cover_doc: the editable layers (text, positions, stroke paths, doodles, sticker references). No photo bytes.
alter table user_cafes add column if not exists cover_path text;
alter table user_cafes add column if not exists cover_doc jsonb;

alter table user_cafes drop constraint if exists user_cafes_cover_path_own;
alter table user_cafes add constraint user_cafes_cover_path_own
  check (cover_path is null or cover_path like owner_id::text || '/%');

alter table user_cafes drop constraint if exists user_cafes_cover_doc_size;
alter table user_cafes add constraint user_cafes_cover_doc_size
  check (cover_doc is null or octet_length(cover_doc::text) <= 200000);

-- Changing the cover of a listed room sends it back for review. This is a separate trigger so it
-- works alongside user_cafes_guard (and any later change to that function).
create or replace function user_cafes_cover_guard() returns trigger
language plpgsql as $$
begin
  if is_logia_admin() then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'public' and new.status = 'public'
     and new.cover_path is distinct from old.cover_path then
    new.status := 'pending';
  end if;
  return new;
end $$;
drop trigger if exists user_cafes_cover_guard_trg on user_cafes;
create trigger user_cafes_cover_guard_trg before update on user_cafes
  for each row execute function user_cafes_cover_guard();
