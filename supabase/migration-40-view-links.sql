-- ============================================================
-- Logia migration 40: view links (look at a space without an account)
-- Requires migrations 38 (space header) and 39 (shared items, copying). Run in the Supabase SQL Editor. Safe to re-run.
--
-- A view link is a long random token (made in the app, never the space id). Anyone holding a non-revoked token can
-- call get_space_view() and the preview functions below, with or without an account. They get ONLY:
--   - the space name, subject, header (kind, colour, and whether a header image exists),
--   - the creator's text / sticky / image stickers, widget colours and home layout, and only when allow_design_clone is on,
--   - the notebooks and decks listed in space_shared_items (titles, covers, counts, sharer name) and their note/card text,
--   - the copy permission flags.
-- It NEVER returns files, library books, lecture audio, past papers, chat, members, calendar, course marks, or any note or
-- deck that is not in space_shared_items. The underlying tables are not opened up.
-- ============================================================

create table if not exists space_view_links (
  id         uuid        primary key default gen_random_uuid(),
  space_id   uuid        not null references spaces (id) on delete cascade,
  token      text        not null unique check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_by uuid        not null default auth.uid() references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  view_count integer     not null default 0
);
create index if not exists space_view_links_space on space_view_links (space_id, created_at);

alter table space_view_links enable row level security;

-- Who may create, list and revoke: the creator, or (peer spaces) anyone who may edit the space header.
create or replace function vl_can_manage(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from spaces s where s.id = p_space and (s.created_by = auth.uid() or can_edit_space_header(p_space))
  );
$$;
revoke all on function vl_can_manage(uuid) from public, anon;
grant execute on function vl_can_manage(uuid) to authenticated;

-- Managers read their links (the token is shown to them). Writes only go through the functions below.
drop policy if exists "view links manager read" on space_view_links;
create policy "view links manager read" on space_view_links for select to authenticated
  using (vl_can_manage(space_id));

create or replace function create_view_link(p_space uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r space_view_links;
begin
  if not vl_can_manage(p_space) then raise exception 'You cannot share a view link for this space.'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then raise exception 'That link could not be made.'; end if;
  if (select count(*) from space_view_links l where l.space_id = p_space and l.revoked_at is null) >= 10 then
    raise exception 'This space already has 10 active view links. Stop one before making another.';
  end if;
  insert into space_view_links (space_id, token, created_by) values (p_space, p_token, auth.uid()) returning * into r;
  return jsonb_build_object('id', r.id, 'token', r.token, 'created_at', r.created_at, 'view_count', r.view_count);
end $$;
revoke all on function create_view_link(uuid, text) from public, anon;
grant execute on function create_view_link(uuid, text) to authenticated;

create or replace function revoke_view_link(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sp uuid;
begin
  select space_id into sp from space_view_links where id = p_id;
  if sp is null or not vl_can_manage(sp) then raise exception 'You cannot change this link.'; end if;
  update space_view_links set revoked_at = now() where id = p_id and revoked_at is null;
end $$;
revoke all on function revoke_view_link(uuid) from public, anon;
grant execute on function revoke_view_link(uuid) to authenticated;

-- ── Internal: the space a live token points at (null if unknown or revoked) ──
create or replace function vl_space(p_token text) returns uuid
language sql stable security definer set search_path = public as $$
  select l.space_id from space_view_links l
   where p_token is not null and length(p_token) between 32 and 128 and l.token = p_token and l.revoked_at is null;
$$;
revoke all on function vl_space(text) from public, anon, authenticated;

-- ── What an anonymous viewer gets ─────────────────────────────
-- Volatile because it counts the view (managers looking at their own link are not counted).
create or replace function get_space_view(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  sp uuid := vl_space(p_token); s spaces; design jsonb := null; items jsonb;
begin
  if sp is null then return null; end if;
  select * into s from spaces where id = sp;
  if not found then return null; end if;

  if not vl_can_manage(sp) then
    update space_view_links set view_count = view_count + 1 where token = p_token;
  end if;

  if s.allow_design_clone then
    design := jsonb_build_object(
      'widgets', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', w.id, 'kind', w.kind,
                 'data', case when w.kind = 'image'
                              then (w.data - 'path') || jsonb_build_object('has_file', coalesce(w.data ->> 'path', '') <> '')
                              else w.data - 'legacyId' end) order by w.created_at)
          from (select x.* from space_widgets x
                 where x.space_id = sp and x.user_id = s.created_by and x.kind in ('text', 'sticky', 'image')
                 order by x.created_at limit 60) w
      ), '[]'::jsonb),
      'colors', coalesce((
        select jsonb_object_agg(e.key, e.value)
          from space_widget_colors c, jsonb_each(c.colors) e
         where c.space_id = sp and c.user_id = s.created_by and e.key like 'cw-%'
      ), '{}'::jsonb),
      'layout', s.design_layout
    );
  end if;

  select coalesce(jsonb_agg(i order by i ->> 'created_at'), '[]'::jsonb) into items from (
    select jsonb_build_object(
             'share_id', sh.id, 'kind', sh.kind, 'title', n.name,
             'cover_kind', case when n.cover_kind = 'image' then 'color' else n.cover_kind end,
             'cover_value', case when n.cover_kind = 'image' then '#E9806E' else n.cover_value end,
             'icon', n.icon,
             'item_count', (select count(*)::int from notes t where t.notebook_id = n.id and t.created_by = sh.owner_id),
             'owner_name', coalesce(nullif(btrim(p.display_name), ''), 'A Logia student'),
             'created_at', sh.created_at) as i
      from space_shared_items sh
      join notebooks n on sh.kind = 'notebook' and n.id = sh.item_id and n.space_id = sh.space_id and n.created_by = sh.owner_id
      left join profiles p on p.id = sh.owner_id
     where sh.space_id = sp
    union all
    select jsonb_build_object(
             'share_id', sh.id, 'kind', sh.kind, 'title', d.title,
             'cover_kind', null, 'cover_value', null, 'icon', null,
             'item_count', coalesce(jsonb_array_length(case when jsonb_typeof(d.cards_json) = 'array' then d.cards_json else '[]'::jsonb end), 0),
             'owner_name', coalesce(nullif(btrim(p.display_name), ''), 'A Logia student'),
             'created_at', sh.created_at)
      from space_shared_items sh
      join active_recall_decks d on sh.kind = 'deck' and d.deck_id = sh.item_id and d.space_id = sh.space_id and d.created_by = sh.owner_id
      left join profiles p on p.id = sh.owner_id
     where sh.space_id = sp
  ) q;

  return jsonb_build_object(
    'name', s.name, 'subject', s.subject, 'copied_from_name', s.copied_from_name,
    'header_kind', coalesce(s.header_kind, 'default'),
    'header_color', case when s.header_kind = 'color' then s.header_color else null end,
    'has_header_image', (s.header_kind = 'image' and coalesce(s.header_image_path, '') <> ''),
    'allow_design', s.allow_design_clone, 'allow_content', s.allow_content_clone,
    'design', design, 'items', items);
end $$;
revoke all on function get_space_view(text) from public;
grant execute on function get_space_view(text) to anon, authenticated;

-- ── Which stored image a viewer may be sent to (the app never sees a client-chosen path) ──
-- p_kind 'header' (p_id ignored) or 'widget' (an image sticker upload; only when the design is shared).
create or replace function view_media_path(p_token text, p_kind text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare sp uuid := vl_space(p_token); s spaces; pth text;
begin
  if sp is null then return null; end if;
  select * into s from spaces where id = sp;
  if p_kind = 'header' then
    if s.header_kind = 'image' then pth := s.header_image_path; end if;
  elsif p_kind = 'widget' then
    if s.allow_design_clone then
      select w.data ->> 'path' into pth from space_widgets w
       where w.id = p_id and w.space_id = sp and w.user_id = s.created_by and w.kind = 'image' and w.data ->> 'source' = 'upload';
    end if;
  end if;
  if pth is null or pth = '' or pth like '%..%' then return null; end if;
  return pth;
end $$;
revoke all on function view_media_path(text, text, uuid) from public;
grant execute on function view_media_path(text, text, uuid) to anon, authenticated;

-- ── Previews (read only), authorised by a live token and a share id in that token's space ──
create or replace function view_notebook_preview(p_token text, p_share_id uuid)
returns table (note_id uuid, title text, body text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare sp uuid := vl_space(p_token); s space_shared_items;
begin
  if sp is null then return; end if;
  select * into s from space_shared_items where id = p_share_id and kind = 'notebook' and space_id = sp;
  if not found then return; end if;
  return query
    select t.id, coalesce(t.title, ''), coalesce(t.body, ''), t.updated_at
      from notes t
      join notebooks n on n.id = t.notebook_id and n.space_id = s.space_id and n.created_by = s.owner_id
     where t.notebook_id = s.item_id and t.created_by = s.owner_id
     order by t.updated_at desc limit 200;
end $$;
revoke all on function view_notebook_preview(text, uuid) from public;
grant execute on function view_notebook_preview(text, uuid) to anon, authenticated;

create or replace function view_deck_preview(p_token text, p_share_id uuid)
returns table (card_id text, concept text, question text, hint text, answer text)
language plpgsql stable security definer set search_path = public as $$
declare sp uuid := vl_space(p_token); s space_shared_items;
begin
  if sp is null then return; end if;
  select * into s from space_shared_items where id = p_share_id and kind = 'deck' and space_id = sp;
  if not found then return; end if;
  return query
    select c.elem ->> 'id', coalesce(c.elem ->> 'concept', ''), coalesce(c.elem ->> 'question', ''),
           coalesce(c.elem ->> 'hint', ''), coalesce(c.elem ->> 'answer', '')
      from active_recall_decks d
      cross join lateral jsonb_array_elements(case when jsonb_typeof(d.cards_json) = 'array' then d.cards_json else '[]'::jsonb end)
                 with ordinality as c(elem, ord)
     where d.deck_id = s.item_id and d.space_id = s.space_id and d.created_by = s.owner_id and jsonb_typeof(c.elem) = 'object'
     order by c.ord limit 1000;
end $$;
revoke all on function view_deck_preview(text, uuid) from public;
grant execute on function view_deck_preview(text, uuid) to anon, authenticated;

-- ── Signed-in people: "Add to mine" from a view link ──────────
create or replace function copy_shared_via_link(p_token text, p_share_id uuid, p_target_space uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sp uuid := vl_space(p_token); s space_shared_items; r record; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if sp is null then raise exception 'This link no longer works.'; end if;
  select * into s from space_shared_items where id = p_share_id and space_id = sp;
  if not found then raise exception 'That shared item is not available.'; end if;
  if not is_space_member(p_target_space) then raise exception 'Choose one of your own spaces.'; end if;
  if s.kind = 'notebook' then
    select * into r from shr_copy_notebook(s.item_id, p_target_space, uid, s.owner_id, true);
    return jsonb_build_object('kind', 'notebook', 'new_id', r.new_id, 'name', r.name, 'space_id', p_target_space,
      'copied', r.copied, 'total', r.total, 'truncated', r.total > r.copied, 'images_removed', r.images);
  else
    select * into r from shr_copy_deck(s.item_id, p_target_space, uid, true);
    return jsonb_build_object('kind', 'deck', 'new_id', r.new_id, 'name', r.name, 'space_id', p_target_space,
      'copied', r.copied, 'total', r.total, 'truncated', r.total > r.copied, 'images_removed', 0);
  end if;
end $$;
revoke all on function copy_shared_via_link(text, uuid, uuid) from public, anon;
grant execute on function copy_shared_via_link(text, uuid, uuid) to authenticated;

-- ── Copying a whole space ─────────────────────────────────────
-- The body of migration 39's clone_public_space, without the "must be public" test, so a view link can also be
-- cloned. Each caller checks who may copy. Not callable by users directly.
create or replace function shr_clone_core(p_space uuid, p_with_design boolean, p_with_content boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); src spaces; nid uuid; mt text; nm text; has boolean;
  r record; x record; newrow uuid; wmap jsonb := '{}'::jsonb; pend jsonb := '[]'::jsonb; hdr text := null;
  oldcolors jsonb; newcolors jsonb := '{}'::jsonb;
  nbs integer := 0; decks_n integer := 0; notes_n integer := 0; cards_n integer := 0; stickers integer := 0;
  truncated boolean := false; images integer := 0;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into src from spaces s where s.id = p_space;
  if not found then raise exception 'This space is not open to copy.'; end if;
  if not (coalesce(p_with_design, false) or coalesce(p_with_content, false)) then raise exception 'Choose what to copy.'; end if;
  if coalesce(p_with_design, false) and not src.allow_design_clone then raise exception 'The creator has not allowed copying this space''s design.'; end if;
  if coalesce(p_with_content, false) and not src.allow_content_clone then raise exception 'The creator has not allowed copying their notes and flashcards.'; end if;
  if (select count(*) from space_clone_log l where l.user_id = uid and l.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have copied 5 spaces in the last day. Try again tomorrow.';
  end if;
  insert into space_clone_log (user_id, source) values (uid, p_space);

  nm := left(src.name, 53) || ' (copy)';
  insert into spaces (name, subject, type, created_by) values (nm, src.subject, 'peer', uid) returning id into nid;
  update spaces set copied_from_name = src.name, copied_from_space = src.id where id = nid;

  select c.table_name into mt
    from information_schema.columns c
    join information_schema.columns u on u.table_schema = c.table_schema and u.table_name = c.table_name and u.column_name = 'user_id'
   where c.table_schema = 'public' and c.column_name = 'space_id' and c.table_name ilike '%member%'
   order by (c.table_name = 'space_members') desc limit 1;
  if mt is not null then
    execute format('select exists (select 1 from %I m where m.space_id = $1 and m.user_id = $2)', mt) into has using nid, uid;
    if not has then
      begin
        execute format('insert into %I (space_id, user_id, role) values ($1, $2, ''admin'')', mt) using nid, uid;
      exception when others then
        execute format('insert into %I (space_id, user_id) values ($1, $2)', mt) using nid, uid;
      end;
    end if;
  end if;

  if p_with_design then
    update spaces set design_layout = src.design_layout where id = nid;
    begin
      if (to_jsonb(src) ->> 'header_kind') = 'color' and (to_jsonb(src) ->> 'header_color') ~ '^#[0-9a-fA-F]{6}$' then
        update spaces set header_kind = 'color', header_color = to_jsonb(src) ->> 'header_color' where id = nid;
      elsif (to_jsonb(src) ->> 'header_kind') = 'image' and coalesce(to_jsonb(src) ->> 'header_image_path', '') <> '' then
        hdr := to_jsonb(src) ->> 'header_image_path';
      end if;
    exception when undefined_column then null;
    end;

    for r in select w.id, w.kind, w.data from space_widgets w
              where w.user_id = src.created_by and w.space_id = p_space and w.kind in ('text', 'sticky', 'image')
              order by w.created_at limit 60 loop
      newrow := null;
      begin
        if r.kind = 'image' and r.data ->> 'source' = 'upload' then
          if coalesce(r.data ->> 'path', '') <> '' then
            insert into space_widgets (user_id, space_id, kind, data)
              values (uid, nid, 'image', (r.data - 'path') || jsonb_build_object('pending', true)) returning id into newrow;
            pend := pend || jsonb_build_array(jsonb_build_object('id', newrow, 'path', r.data ->> 'path'));
          end if;
        elsif r.kind = 'image' and r.data ->> 'source' = 'link' then
          insert into space_widgets (user_id, space_id, kind, data) values (uid, nid, 'image', r.data) returning id into newrow;
        elsif r.kind in ('text', 'sticky') then
          insert into space_widgets (user_id, space_id, kind, data) values (uid, nid, r.kind, r.data - 'legacyId') returning id into newrow;
        end if;
      exception when check_violation then newrow := null;
      end;
      if newrow is not null then
        wmap := wmap || jsonb_build_object(r.id::text, newrow::text);
        stickers := stickers + 1;
      end if;
    end loop;

    select c.colors into oldcolors from space_widget_colors c where c.user_id = src.created_by and c.space_id = p_space;
    for x in select e.key as k, e.value #>> '{}' as v from jsonb_each(coalesce(oldcolors, '{}'::jsonb)) e loop
      if wmap ? x.k then newcolors := newcolors || jsonb_build_object(wmap ->> x.k, x.v);
      elsif x.k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then newcolors := newcolors || jsonb_build_object(x.k, x.v);
      end if;
    end loop;
    if newcolors <> '{}'::jsonb then
      insert into space_widget_colors (user_id, space_id, colors) values (uid, nid, newcolors) on conflict do nothing;
    end if;
  end if;

  for r in select n.id from notebooks n where n.space_id = p_space and n.created_by = src.created_by order by n.sort, n.created_at limit 100 loop
    select * into x from shr_copy_notebook(r.id, nid, uid, src.created_by, p_with_content);
    nbs := nbs + 1; notes_n := notes_n + x.copied; images := images + x.images;
    if x.total > x.copied then truncated := true; end if;
  end loop;

  for r in select d.deck_id from active_recall_decks d where d.space_id = p_space and d.created_by = src.created_by order by d.title limit 50 loop
    select * into x from shr_copy_deck(r.deck_id, nid, uid, p_with_content);
    decks_n := decks_n + 1; cards_n := cards_n + x.copied;
    if x.total > x.copied then truncated := true; end if;
  end loop;

  return jsonb_build_object('space_id', nid, 'name', nm, 'notebooks', nbs, 'decks', decks_n, 'notes', notes_n,
                            'cards', cards_n, 'stickers', stickers, 'truncated', truncated, 'images_removed', images,
                            'pending_images', pend, 'header_path', hdr);
end $$;
revoke all on function shr_clone_core(uuid, boolean, boolean) from public, anon, authenticated;

-- Public spaces: same behaviour as migration 39, now a thin wrapper.
create or replace function clone_public_space(p_space uuid, p_with_design boolean, p_with_content boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from spaces s where s.id = p_space and s.is_public and not coalesce(s.hidden, false)) then
    raise exception 'This space is not open to copy.';
  end if;
  return shr_clone_core(p_space, p_with_design, p_with_content);
end $$;
grant execute on function clone_public_space(uuid, boolean, boolean) to authenticated;

-- View links: what the creator allows (design, content) decides what can be copied, exactly as for a public space.
create or replace function clone_space_via_link(p_token text, p_with_design boolean, p_with_content boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sp uuid := vl_space(p_token);
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if sp is null then raise exception 'This link no longer works.'; end if;
  return shr_clone_core(sp, p_with_design, p_with_content);
end $$;
revoke all on function clone_space_via_link(text, boolean, boolean) from public, anon;
grant execute on function clone_space_via_link(text, boolean, boolean) to authenticated;

-- ── Storage: exactly the files a live view link shows ─────────
-- Image stickers (only when the creator allows design copying) and the header image of a space that has a live link.
-- Readable by anon so a signed URL can be made with the anon key. Nothing else in these buckets is exposed.
create or replace function vl_file_ok(p_kind text, p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_name is null or p_name like '%..%' then return false; end if;
  if p_kind = 'widget' then
    return exists (select 1 from space_widgets w join spaces s on s.id = w.space_id
                    where s.allow_design_clone and w.user_id = s.created_by and w.kind = 'image'
                      and w.data ->> 'path' = p_name
                      and exists (select 1 from space_view_links l where l.space_id = s.id and l.revoked_at is null));
  end if;
  return exists (select 1 from spaces s
                  where s.header_kind = 'image' and s.header_image_path = p_name
                    and exists (select 1 from space_view_links l where l.space_id = s.id and l.revoked_at is null));
end $$;
revoke all on function vl_file_ok(text, text) from public;
grant execute on function vl_file_ok(text, text) to anon, authenticated;

drop policy if exists "space-widgets read via view link" on storage.objects;
create policy "space-widgets read via view link" on storage.objects for select to anon, authenticated
  using (bucket_id = 'space-widgets' and vl_file_ok('widget', name));
drop policy if exists "space-headers read via view link" on storage.objects;
create policy "space-headers read via view link" on storage.objects for select to anon, authenticated
  using (bucket_id = 'space-headers' and vl_file_ok('header', name));

insert into migrations_applied (name) values ('migration-40-view-links') on conflict (name) do nothing;
