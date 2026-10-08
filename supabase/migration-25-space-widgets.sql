-- ============================================================
-- Logia migration 25: custom space-home widgets (GIPHY GIFs / stickers, images, text) and widget colours
-- Run in the Supabase SQL Editor. Safe to re-run. Private to each person.
-- ============================================================

-- True when the signed-in user belongs to the space. The member table is not defined in these
-- migrations, so (like list_public_spaces in migration 22) find it: a table with space_id + user_id
-- and "member" in its name. Falls back to the space creator if no such table exists.
create or replace function is_space_member(_space uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare mt text; ok boolean;
begin
  if auth.uid() is null then return false; end if;
  select c.table_name into mt
    from information_schema.columns c
    join information_schema.columns u on u.table_schema = c.table_schema and u.table_name = c.table_name and u.column_name = 'user_id'
   where c.table_schema = 'public' and c.column_name = 'space_id' and c.table_name ilike '%member%'
   order by (c.table_name = 'space_members') desc limit 1;
  if mt is not null then
    execute format('select exists (select 1 from %I m where m.space_id = $1 and m.user_id = $2)', mt)
      into ok using _space, auth.uid();
    if ok then return true; end if;
  end if;
  return exists (select 1 from spaces s where s.id = _space and s.created_by = auth.uid());
end $$;
grant execute on function is_space_member(uuid) to authenticated;

create table if not exists space_widgets (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references profiles (id) on delete cascade,
  space_id   uuid        not null references spaces (id) on delete cascade,
  kind       text        not null,
  data       jsonb       not null default '{}'::jsonb check (pg_column_size(data) <= 4096),
  created_at timestamptz not null default now()
);
create index if not exists space_widgets_user_space on space_widgets (user_id, space_id, created_at);

alter table space_widgets enable row level security;
drop policy if exists "space_widgets self" on space_widgets;
create policy "space_widgets self" on space_widgets for all to authenticated
  using (user_id = auth.uid() and is_space_member(space_id))
  with check (user_id = auth.uid() and is_space_member(space_id));

alter table space_widgets drop constraint if exists space_widgets_kind_check;
alter table space_widgets add constraint space_widgets_kind_check check (kind in ('gif', 'image', 'text'));

-- Per-person widget colours for a space: { "<widget id>": "<swatch key>" }. Covers built-in and custom widgets.
create table if not exists space_widget_colors (
  user_id    uuid        not null default auth.uid() references profiles (id) on delete cascade,
  space_id   uuid        not null references spaces (id) on delete cascade,
  colors     jsonb       not null default '{}'::jsonb check (pg_column_size(colors) <= 4096),
  updated_at timestamptz not null default now(),
  primary key (user_id, space_id)
);
alter table space_widget_colors enable row level security;
drop policy if exists "space_widget_colors self" on space_widget_colors;
create policy "space_widget_colors self" on space_widget_colors for all to authenticated
  using (user_id = auth.uid() and is_space_member(space_id))
  with check (user_id = auth.uid() and is_space_member(space_id));

-- Private bucket for uploaded images: <user id>/<space id>/<file>. Served only as signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('space-widgets', 'space-widgets', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "space-widgets upload own" on storage.objects;
create policy "space-widgets upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'space-widgets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "space-widgets read own" on storage.objects;
create policy "space-widgets read own" on storage.objects for select to authenticated
  using (bucket_id = 'space-widgets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "space-widgets delete own" on storage.objects;
create policy "space-widgets delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'space-widgets' and (storage.foldername(name))[1] = auth.uid()::text);
