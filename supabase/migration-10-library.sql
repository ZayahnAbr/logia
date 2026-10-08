-- ============================================================
-- StudySpace migration 10 — personal textbook library
-- (PDF upload, highlights, bookmarks). Run in the Supabase SQL Editor.
-- ============================================================

create table library_books (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references profiles (id) on delete cascade,
  title       text        not null,                 -- original display filename (minus .pdf)
  file_path   text        not null,                 -- storage path: <user_id>/<uuid>.pdf
  size_bytes  bigint      not null default 0,
  page_count  int,
  last_page   int         not null default 1,
  created_at  timestamptz not null default now(),
  opened_at   timestamptz
);
create index on library_books (user_id, created_at);

create table library_highlights (
  id         uuid        primary key default gen_random_uuid(),
  book_id    uuid        not null references library_books (id) on delete cascade,
  user_id    uuid        not null references profiles (id) on delete cascade,
  page       int         not null,
  text       text        not null,
  color      text        not null default 'yellow',
  rects      jsonb       not null,                  -- [{x,y,w,h}] as fractions of the page box
  note       text        not null default '',
  created_at timestamptz not null default now()
);
create index on library_highlights (book_id, page);

create table library_bookmarks (
  id         uuid        primary key default gen_random_uuid(),
  book_id    uuid        not null references library_books (id) on delete cascade,
  user_id    uuid        not null references profiles (id) on delete cascade,
  page       int         not null,
  label      text        not null default '',
  created_at timestamptz not null default now(),
  unique (book_id, page)
);

alter table library_books      enable row level security;
alter table library_highlights enable row level security;
alter table library_bookmarks  enable row level security;
create policy "books self"      on library_books      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "highlights self" on library_highlights for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "bookmarks self"  on library_bookmarks  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private storage bucket; each user can only touch files under their own <user_id>/ folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 104857600, array['application/pdf'])
on conflict (id) do nothing;

create policy "library read own"   on storage.objects for select using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library upload own" on storage.objects for insert with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library delete own" on storage.objects for delete using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
