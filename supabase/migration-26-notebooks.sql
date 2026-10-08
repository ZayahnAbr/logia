-- ============================================================
-- Logia migration 26: Notebooks (covers) replace note folders
-- Requires migration 25 (is_space_member). Run in the Supabase SQL Editor. Safe to re-run.
-- notes.folder stays as a mirror of the notebook name so older code and search keep working.
-- ============================================================

create table if not exists notebooks (
  id          uuid        primary key default gen_random_uuid(),
  space_id    uuid        not null references spaces (id) on delete cascade,
  name        text        not null check (char_length(btrim(name)) between 1 and 60),
  cover_kind  text        not null default 'color' check (cover_kind in ('color', 'pattern', 'image', 'emoji')),
  cover_value text        not null default '#E9806E' check (char_length(cover_value) <= 300),
  icon        text        check (icon is null or char_length(icon) <= 16),
  sort        integer     not null default 0,
  created_by  uuid        references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notebooks_space_sort on notebooks (space_id, sort, created_at);
create unique index if not exists notebooks_space_name_uq on notebooks (space_id, lower(btrim(name)));

alter table notebooks enable row level security;
drop policy if exists "notebooks members read" on notebooks;
create policy "notebooks members read" on notebooks for select to authenticated
  using (is_space_member(space_id));
drop policy if exists "notebooks members insert" on notebooks;
create policy "notebooks members insert" on notebooks for insert to authenticated
  with check (is_space_member(space_id) and created_by = auth.uid());
drop policy if exists "notebooks members update" on notebooks;
create policy "notebooks members update" on notebooks for update to authenticated
  using (is_space_member(space_id)) with check (is_space_member(space_id));
drop policy if exists "notebooks members delete" on notebooks;
create policy "notebooks members delete" on notebooks for delete to authenticated
  using (is_space_member(space_id));

-- Notes: notebook link and an optional cover of their own.
alter table notes add column if not exists notebook_id  uuid references notebooks (id) on delete set null;
alter table notes add column if not exists cover_kind   text;
alter table notes add column if not exists cover_value  text;
alter table notes drop constraint if exists notes_cover_kind_check;
alter table notes add constraint notes_cover_kind_check
  check (cover_kind is null or cover_kind in ('color', 'pattern', 'image', 'emoji'));
alter table notes drop constraint if exists notes_cover_value_check;
alter table notes add constraint notes_cover_value_check
  check (cover_value is null or char_length(cover_value) <= 300);
create index if not exists notes_notebook on notes (notebook_id);

-- Move existing folder names into notebooks, one per space and name ("General" stays loose).
-- Cover colours are picked from the palette by name, so re-running changes nothing.
insert into notebooks (space_id, name, cover_kind, cover_value, sort, created_by)
select f.space_id, f.name, 'color',
       (array['#E9806E','#C8694F','#D9A441','#7FA68A','#4F9A94','#6C9BD1','#6F7FC4','#9B6FB5','#D77A9A','#6B7785'])
         [1 + (abs(hashtext(f.name)) % 10)],
       (row_number() over (partition by f.space_id order by f.name))::int,
       (select n2.created_by from notes n2
         where n2.space_id = f.space_id and btrim(n2.folder) = f.name and n2.created_by is not null limit 1)
from (
  select distinct space_id, left(btrim(folder), 60) as name
    from notes
   where folder is not null and btrim(folder) <> '' and lower(btrim(folder)) <> 'general'
) f
on conflict do nothing;

update notes n set notebook_id = b.id
  from notebooks b
 where n.notebook_id is null
   and b.space_id = n.space_id
   and lower(btrim(b.name)) = lower(left(btrim(n.folder), 60))
   and lower(btrim(n.folder)) <> 'general';

-- Private bucket for uploaded covers: <user id>/<space id>/<file>. JPG, PNG or WebP, 5 MB.
-- Only the uploader can write or delete; space members can read (to see covers in shared spaces).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notebook-covers', 'notebook-covers', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "notebook-covers upload own" on storage.objects;
create policy "notebook-covers upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'notebook-covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "notebook-covers read" on storage.objects;
create policy "notebook-covers read" on storage.objects for select to authenticated
  using (bucket_id = 'notebook-covers' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and is_space_member(((storage.foldername(name))[2])::uuid))
  ));
drop policy if exists "notebook-covers delete own" on storage.objects;
create policy "notebook-covers delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'notebook-covers' and (storage.foldername(name))[1] = auth.uid()::text);
