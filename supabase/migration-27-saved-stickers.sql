-- ============================================================
-- Logia migration 27: personal saved-sticker library (usable in any space)
-- Requires migration 25 (the private space-widgets bucket and its own-folder policies).
-- Run in the Supabase SQL Editor. Safe to re-run.
-- Files live at <user id>/library/<uuid>.png in the space-widgets bucket. The existing
-- migration 25 policies already match on the first folder (the user id), so they cover this path.
-- Placing a saved sticker copies the file into the space's own path, so deleting from the
-- library never breaks stickers that are already placed.
-- ============================================================

create table if not exists saved_stickers (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references profiles (id) on delete cascade,
  path       text        not null,
  alt        text        not null default '' check (char_length(alt) <= 200),
  width      integer     not null default 0,
  height     integer     not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists saved_stickers_user on saved_stickers (user_id, created_at desc);

alter table saved_stickers enable row level security;
drop policy if exists "saved_stickers self" on saved_stickers;
create policy "saved_stickers self" on saved_stickers for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and path like auth.uid()::text || '/library/%');

-- Re-assert the own-folder storage policies from migration 25 (harmless if already present).
drop policy if exists "space-widgets upload own" on storage.objects;
create policy "space-widgets upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'space-widgets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "space-widgets read own" on storage.objects;
create policy "space-widgets read own" on storage.objects for select to authenticated
  using (bucket_id = 'space-widgets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "space-widgets delete own" on storage.objects;
create policy "space-widgets delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'space-widgets' and (storage.foldername(name))[1] = auth.uid()::text);
