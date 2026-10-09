-- ============================================================
-- Logia migration 38: customisable space header (default coral, a colour, or a cropped image)
-- Run in the Supabase SQL Editor. Safe to re-run. Requires migration 25 (is_space_member).
-- The header is shared by everyone in the space.
-- Who may change it: any member of a peer space; for a class hub (type 'teacher_hub') only the creator.
-- ============================================================

alter table spaces add column if not exists header_kind text;
alter table spaces add column if not exists header_color text;
alter table spaces add column if not exists header_image_path text;

alter table spaces drop constraint if exists spaces_header_kind_check;
alter table spaces add constraint spaces_header_kind_check check (header_kind is null or header_kind in ('default', 'color', 'image'));
alter table spaces drop constraint if exists spaces_header_color_check;
alter table spaces add constraint spaces_header_color_check check (header_color is null or header_color ~ '^#[0-9a-fA-F]{6}$');

-- True when the signed-in user may change this space's header.
create or replace function can_edit_space_header(_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from spaces s
     where s.id = _space
       and ((s.type = 'teacher_hub' and s.created_by = auth.uid())
         or (s.type <> 'teacher_hub' and is_space_member(_space)))
  );
$$;
grant execute on function can_edit_space_header(uuid) to authenticated;

-- First folder of a storage path as a uuid, or null if it is not one (so policies never fail on a bad cast).
create or replace function header_space_of(_name text) returns uuid
language sql immutable set search_path = public as $$
  select case when split_part(_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(_name, '/', 1)::uuid end;
$$;
grant execute on function header_space_of(text) to authenticated;

-- The only write path for the header columns (the spaces update policy is left alone).
create or replace function set_space_header(p_space uuid, p_kind text, p_color text, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not can_edit_space_header(p_space) then
    raise exception 'You cannot change this space header';
  end if;
  if p_kind = 'default' then
    update spaces set header_kind = 'default', header_color = null, header_image_path = null where id = p_space;
  elsif p_kind = 'color' then
    if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid colour'; end if;
    update spaces set header_kind = 'color', header_color = lower(p_color), header_image_path = null where id = p_space;
  elsif p_kind = 'image' then
    if p_path is null or header_space_of(p_path) is distinct from p_space or p_path !~ '^[0-9a-f-]{36}/[0-9a-zA-Z-]+\.jpg$' then
      raise exception 'Invalid image';
    end if;
    update spaces set header_kind = 'image', header_color = null, header_image_path = p_path where id = p_space;
  else
    raise exception 'Invalid header';
  end if;
end $$;
grant execute on function set_space_header(uuid, text, text, text) to authenticated;

-- Private bucket: <space id>/<uuid>.jpg, 5 MB, served only as signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('space-headers', 'space-headers', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "space-headers read members" on storage.objects;
create policy "space-headers read members" on storage.objects for select to authenticated
  using (bucket_id = 'space-headers' and header_space_of(name) is not null and is_space_member(header_space_of(name)));
drop policy if exists "space-headers upload editors" on storage.objects;
create policy "space-headers upload editors" on storage.objects for insert to authenticated
  with check (bucket_id = 'space-headers' and header_space_of(name) is not null and can_edit_space_header(header_space_of(name)));
drop policy if exists "space-headers delete editors" on storage.objects;
create policy "space-headers delete editors" on storage.objects for delete to authenticated
  using (bucket_id = 'space-headers' and header_space_of(name) is not null and can_edit_space_header(header_space_of(name)));
