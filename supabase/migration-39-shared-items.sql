-- ============================================================
-- Logia migration 39: shared notebooks and flashcards, and copying a public space
-- Requires migrations 22 (public spaces), 25 (is_space_member) and 26 (notebooks). Run in the Supabase SQL Editor. Safe to re-run.
--
-- Only notes written in Logia (the notes table) and flashcard decks (active_recall_decks.cards_json) can ever be
-- shared or copied. Files, library books, lecture audio, past papers and uploaded images are never read here.
-- The underlying notes/decks tables are NOT opened up: everything goes through SECURITY DEFINER functions that
-- check visibility (space member, or the space is public and not hidden).
-- ============================================================

-- ── Who may see a space's shared content ──────────────────────
create or replace function shr_can_view(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    is_space_member(p_space)
    or exists (select 1 from spaces s where s.id = p_space and s.is_public and not coalesce(s.hidden, false))
  );
$$;
grant execute on function shr_can_view(uuid) to authenticated;

-- ── The showcase table ────────────────────────────────────────
create table if not exists space_shared_items (
  id         uuid        primary key default gen_random_uuid(),
  space_id   uuid        not null references spaces (id) on delete cascade,
  owner_id   uuid        not null default auth.uid() references profiles (id) on delete cascade,
  kind       text        not null check (kind in ('notebook', 'deck')),
  item_id    uuid        not null,
  created_at timestamptz not null default now(),
  unique (space_id, kind, item_id)
);
create index if not exists space_shared_items_space on space_shared_items (space_id, created_at);

alter table space_shared_items enable row level security;

-- Direct reads are limited to your own rows (the picker). Everyone else reads through shared_items_for_space().
drop policy if exists "shared items own read" on space_shared_items;
create policy "shared items own read" on space_shared_items for select to authenticated
  using (owner_id = auth.uid());

-- Insert only your own items, in a space you belong to.
drop policy if exists "shared items own insert" on space_shared_items;
create policy "shared items own insert" on space_shared_items for insert to authenticated
  with check (
    owner_id = auth.uid() and is_space_member(space_id) and (
      (kind = 'notebook' and exists (select 1 from notebooks n where n.id = item_id and n.space_id = space_shared_items.space_id and n.created_by = auth.uid()))
      or (kind = 'deck' and exists (select 1 from active_recall_decks d where d.deck_id = item_id and d.space_id = space_shared_items.space_id and d.created_by = auth.uid()))
    )
  );

drop policy if exists "shared items own delete" on space_shared_items;
create policy "shared items own delete" on space_shared_items for delete to authenticated
  using (owner_id = auth.uid());

-- A deleted notebook or deck stops being shared.
create or replace function shr_forget_notebook() returns trigger language plpgsql security definer set search_path = public as $$
begin delete from space_shared_items where kind = 'notebook' and item_id = old.id; return old; end $$;
drop trigger if exists shr_forget_notebook_t on notebooks;
create trigger shr_forget_notebook_t after delete on notebooks for each row execute function shr_forget_notebook();

create or replace function shr_forget_deck() returns trigger language plpgsql security definer set search_path = public as $$
begin delete from space_shared_items where kind = 'deck' and item_id = old.deck_id; return old; end $$;
drop trigger if exists shr_forget_deck_t on active_recall_decks;
create trigger shr_forget_deck_t after delete on active_recall_decks for each row execute function shr_forget_deck();

-- ── The list ──────────────────────────────────────────────────
-- Image covers are not shared (they live in a private bucket), so they read as the default colour.
create or replace function shared_items_for_space(p_space uuid)
returns table (share_id uuid, kind text, item_id uuid, owner_id uuid, owner_name text, is_mine boolean,
               title text, cover_kind text, cover_value text, icon text, item_count integer, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not shr_can_view(p_space) then return; end if;
  return query
    select s.id, s.kind, s.item_id, s.owner_id,
           coalesce(nullif(btrim(p.display_name), ''), 'A Logia student'),
           (s.owner_id = auth.uid()),
           n.name,
           case when n.cover_kind = 'image' then 'color' else n.cover_kind end,
           case when n.cover_kind = 'image' then '#E9806E' else n.cover_value end,
           n.icon,
           (select count(*)::int from notes t where t.notebook_id = n.id and t.created_by = s.owner_id),
           s.created_at
      from space_shared_items s
      join notebooks n on s.kind = 'notebook' and n.id = s.item_id and n.space_id = s.space_id and n.created_by = s.owner_id
      left join profiles p on p.id = s.owner_id
     where s.space_id = p_space
    union all
    select s.id, s.kind, s.item_id, s.owner_id,
           coalesce(nullif(btrim(p.display_name), ''), 'A Logia student'),
           (s.owner_id = auth.uid()),
           d.title, null::text, null::text, null::text,
           coalesce(jsonb_array_length(d.cards_json), 0),
           s.created_at
      from space_shared_items s
      join active_recall_decks d on s.kind = 'deck' and d.deck_id = s.item_id and d.space_id = s.space_id and d.created_by = s.owner_id
      left join profiles p on p.id = s.owner_id
     where s.space_id = p_space
    order by 12;
end $$;
grant execute on function shared_items_for_space(uuid) to authenticated;

-- ── Previews (read only) ──────────────────────────────────────
create or replace function shared_notebook_preview(p_share_id uuid)
returns table (note_id uuid, title text, body text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare s space_shared_items;
begin
  select * into s from space_shared_items where id = p_share_id and kind = 'notebook';
  if not found or not shr_can_view(s.space_id) then return; end if;
  return query
    select t.id, coalesce(t.title, ''), coalesce(t.body, ''), t.updated_at
      from notes t
      join notebooks n on n.id = t.notebook_id and n.space_id = s.space_id and n.created_by = s.owner_id
     where t.notebook_id = s.item_id and t.created_by = s.owner_id
     order by t.updated_at desc limit 200;
end $$;
grant execute on function shared_notebook_preview(uuid) to authenticated;

create or replace function shared_deck_preview(p_share_id uuid)
returns table (card_id text, concept text, question text, hint text, answer text)
language plpgsql stable security definer set search_path = public as $$
declare s space_shared_items;
begin
  select * into s from space_shared_items where id = p_share_id and kind = 'deck';
  if not found or not shr_can_view(s.space_id) then return; end if;
  return query
    select c.elem ->> 'id', coalesce(c.elem ->> 'concept', ''), coalesce(c.elem ->> 'question', ''),
           coalesce(c.elem ->> 'hint', ''), coalesce(c.elem ->> 'answer', '')
      from active_recall_decks d
      cross join lateral jsonb_array_elements(case when jsonb_typeof(d.cards_json) = 'array' then d.cards_json else '[]'::jsonb end)
                 with ordinality as c(elem, ord)
     where d.deck_id = s.item_id and d.space_id = s.space_id and d.created_by = s.owner_id and jsonb_typeof(c.elem) = 'object'
     order by c.ord limit 1000;
end $$;
grant execute on function shared_deck_preview(uuid) to authenticated;

-- ── Internal copy helpers (not callable by users) ─────────────
-- Copies one notebook into p_target for p_user. Only notes written by p_author are copied (or none).
-- Returns: new notebook id, notes copied, notes in the source, notes that had images removed.
create or replace function shr_copy_notebook(p_nb uuid, p_target uuid, p_user uuid, p_author uuid, p_with_notes boolean)
returns table (new_id uuid, name text, copied integer, total integer, images integer)
language plpgsql security definer set search_path = public as $$
declare nb notebooks; base text; nm text; i integer := 1; nid uuid; ck text; cv text; cc integer := 0; tt integer := 0; im integer := 0;
begin
  select * into nb from notebooks where id = p_nb;
  if not found then raise exception 'That notebook no longer exists.'; end if;
  base := nb.name; nm := base;
  while exists (select 1 from notebooks x where x.space_id = p_target and lower(btrim(x.name)) = lower(btrim(nm))) loop
    i := i + 1; nm := left(base, 60 - length(' (' || i || ')')) || ' (' || i || ')';
  end loop;
  -- Image covers live in a private bucket and are not copied.
  ck := case when nb.cover_kind = 'image' then 'color' else nb.cover_kind end;
  cv := case when nb.cover_kind = 'image' then '#E9806E' else nb.cover_value end;
  insert into notebooks (space_id, name, cover_kind, cover_value, icon, sort, created_by)
    values (p_target, nm, ck, cv, nb.icon,
            coalesce((select max(x.sort) from notebooks x where x.space_id = p_target), 0) + 1, p_user)
    returning id into nid;
  if p_with_notes then
    select count(*) into tt from notes t where t.notebook_id = p_nb and t.created_by = p_author;
    with src as (
      select t.title, t.body, t.cover_kind, t.cover_value from notes t
       where t.notebook_id = p_nb and t.created_by = p_author order by t.updated_at desc limit 200
    ), ins as (
      insert into notes (space_id, folder, notebook_id, title, body, created_by, cover_kind, cover_value)
      select p_target, nm, nid, coalesce(src.title, ''),
             regexp_replace(coalesce(src.body, ''), '<img\b[^>]*>', '', 'gi'), p_user,
             case when src.cover_kind = 'image' then null else src.cover_kind end,
             case when src.cover_kind = 'image' then null else src.cover_value end
        from src returning 1
    )
    select count(*) into cc from ins;
    select count(*) into im from (
      select 1 from notes t where t.notebook_id = p_nb and t.created_by = p_author and t.body ~* '<img\b' limit 200
    ) q;
  end if;
  return query select nid, nm, cc, tt, im;
end $$;
revoke all on function shr_copy_notebook(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- Copies one deck (fresh card ids, no review history). p_with_cards false makes an empty deck of the same name.
create or replace function shr_copy_deck(p_deck uuid, p_target uuid, p_user uuid, p_with_cards boolean)
returns table (new_id uuid, name text, copied integer, total integer)
language plpgsql security definer set search_path = public as $$
declare d active_recall_decks; base text; nm text; i integer := 1; nid uuid; cards jsonb := '[]'::jsonb; tt integer := 0;
begin
  select * into d from active_recall_decks where deck_id = p_deck;
  if not found then raise exception 'That deck no longer exists.'; end if;
  base := d.title; nm := base;
  while exists (select 1 from active_recall_decks x where x.space_id = p_target and x.created_by = p_user and lower(btrim(x.title)) = lower(btrim(nm))) loop
    i := i + 1; nm := left(base, 120) || ' (' || i || ')';
  end loop;
  if p_with_cards and jsonb_typeof(d.cards_json) = 'array' then
    tt := jsonb_array_length(d.cards_json);
    select coalesce(jsonb_agg(((c.elem - 'sourceNoteId') || jsonb_build_object('id', gen_random_uuid()::text)) order by c.ord), '[]'::jsonb)
      into cards
      from (select e.elem, e.ord from jsonb_array_elements(d.cards_json) with ordinality as e(elem, ord)
             where jsonb_typeof(e.elem) = 'object' order by e.ord limit 1000) c;
  end if;
  insert into active_recall_decks (space_id, title, subject, created_by, cards_json)
    values (p_target, nm, d.subject, p_user, cards) returning deck_id into nid;
  begin
    update active_recall_decks set front_language = d.front_language, back_language = d.back_language where deck_id = nid;
  exception when undefined_column then null;
  end;
  return query select nid, nm, case when p_with_cards then jsonb_array_length(cards) else 0 end, tt;
end $$;
revoke all on function shr_copy_deck(uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- ── Add to mine ───────────────────────────────────────────────
create or replace function copy_shared_item(p_share_id uuid, p_target_space uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s space_shared_items; r record; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into s from space_shared_items where id = p_share_id;
  if not found or not shr_can_view(s.space_id) then raise exception 'That shared item is not available.'; end if;
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
grant execute on function copy_shared_item(uuid, uuid) to authenticated;

-- ── Copying a whole public space ──────────────────────────────
alter table spaces add column if not exists copied_from_name text;
alter table spaces add column if not exists copied_from_space uuid;
alter table spaces add column if not exists allow_content_clone boolean not null default false;
-- The creator's saved home layout (an array of {id, visible, half}); used as the default layout of copies.
alter table spaces add column if not exists design_layout jsonb;

-- Design copying is on by default for new public spaces. Spaces that were already public have not been asked yet,
-- so they start with it OFF until the creator confirms it in the Make public dialog.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'spaces' and column_name = 'allow_design_clone') then
    alter table spaces add column allow_design_clone boolean not null default true;
    update spaces set allow_design_clone = false where is_public;
  end if;
end $$;

-- Rate limit bookkeeping (no policies: only the function below touches it).
create table if not exists space_clone_log (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null,
  source     uuid        not null,
  created_at timestamptz not null default now()
);
create index if not exists space_clone_log_user on space_clone_log (user_id, created_at);
alter table space_clone_log enable row level security;

-- Creator only: what people may copy from this public space.
create or replace function set_space_clone_options(p_space uuid, p_design boolean, p_content boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update spaces set allow_design_clone = coalesce(p_design, false), allow_content_clone = coalesce(p_content, false)
   where id = p_space and created_by = auth.uid();
  if not found then raise exception 'Only the creator of a space can change this.'; end if;
end $$;
grant execute on function set_space_clone_options(uuid, boolean, boolean) to authenticated;

-- Creator only: save the home layout so copies can start from it.
create or replace function set_space_design_layout(p_space uuid, p_layout jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_layout is not null and (jsonb_typeof(p_layout) <> 'array' or jsonb_array_length(p_layout) > 60 or pg_column_size(p_layout) > 8192) then
    raise exception 'That layout could not be saved.';
  end if;
  update spaces set design_layout = p_layout where id = p_space and created_by = auth.uid();
  if not found then raise exception 'Only the creator of a space can change this.'; end if;
end $$;
grant execute on function set_space_design_layout(uuid, jsonb) to authenticated;

-- What the copy dialog may offer for a public space.
create or replace function public_space_clone_options(p_space uuid)
returns table (allow_design boolean, allow_content boolean)
language sql stable security definer set search_path = public as $$
  select s.allow_design_clone, s.allow_content_clone from spaces s
   where s.id = p_space and s.is_public and not coalesce(s.hidden, false) and auth.uid() is not null;
$$;
grant execute on function public_space_clone_options(uuid) to authenticated;

-- Lets a signed-in user READ (not change) exactly the image stickers and header image of a public space whose
-- creator allowed design copying, so the app can copy those files into the copier's own folders.
create or replace function shr_design_file_ok(p_kind text, p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or p_name is null then return false; end if;
  if p_kind = 'widget' then
    return exists (select 1 from space_widgets w join spaces s on s.id = w.space_id
                    where s.is_public and not coalesce(s.hidden, false) and s.allow_design_clone
                      and w.user_id = s.created_by and w.kind = 'image' and w.data ->> 'path' = p_name);
  end if;
  return exists (select 1 from spaces s
                  where s.is_public and not coalesce(s.hidden, false) and s.allow_design_clone
                    and to_jsonb(s) ->> 'header_image_path' = p_name);
end $$;
grant execute on function shr_design_file_ok(text, text) to authenticated;

drop policy if exists "space-widgets read cloneable" on storage.objects;
create policy "space-widgets read cloneable" on storage.objects for select to authenticated
  using (bucket_id = 'space-widgets' and shr_design_file_ok('widget', name));
drop policy if exists "space-headers read cloneable" on storage.objects;
create policy "space-headers read cloneable" on storage.objects for select to authenticated
  using (bucket_id = 'space-headers' and shr_design_file_ok('header', name));

-- The creator's choices decide what can be copied (design and content separately).
--   Design: name, subject, home stickers (text, sticky notes, image stickers with position, size, colour and text),
--           widget colours, header colour or header image, home layout, and empty notebooks/decks with the same names and covers.
--   Content: the notes and flashcards the creator wrote (200 notes per notebook, 1000 cards per deck, 100 notebooks, 50 decks).
-- Never copied: files, library books, lecture audio, past papers, chat, members, calendar events, course marks,
-- review history. Image sticker files and a header image are copied by the app (it cannot be done in SQL) and counted
-- if one cannot be copied. Limit: 5 copies per person per rolling 24 hours.
drop function if exists clone_public_space(uuid, boolean);
create or replace function clone_public_space(p_space uuid, p_with_design boolean, p_with_content boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); src spaces; nid uuid; mt text; nm text; has boolean;
  r record; x record; newrow uuid; wmap jsonb := '{}'::jsonb; pend jsonb := '[]'::jsonb; hdr text := null;
  oldcolors jsonb; newcolors jsonb := '{}'::jsonb; ck text; cvv text;
  nbs integer := 0; decks_n integer := 0; notes_n integer := 0; cards_n integer := 0; stickers integer := 0;
  truncated boolean := false; images integer := 0;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into src from spaces s where s.id = p_space and s.is_public and not coalesce(s.hidden, false);
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

  -- Membership: mirror a normal createSpace. A trigger usually adds the creator; if not, add the row here.
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
    -- Layout, and header colour (migration 38 columns). A header image is copied by the app afterwards.
    update spaces set design_layout = src.design_layout where id = nid;
    begin
      if (to_jsonb(src) ->> 'header_kind') = 'color' and (to_jsonb(src) ->> 'header_color') ~ '^#[0-9a-fA-F]{6}$' then
        update spaces set header_kind = 'color', header_color = to_jsonb(src) ->> 'header_color' where id = nid;
      elsif (to_jsonb(src) ->> 'header_kind') = 'image' and coalesce(to_jsonb(src) ->> 'header_image_path', '') <> '' then
        hdr := to_jsonb(src) ->> 'header_image_path';
      end if;
    exception when undefined_column then null;
    end;

    -- The creator's home stickers: text, sticky notes and image stickers. Gif rows are not copied.
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

    -- Widget colours: built-in widget ids carry over; sticker ids are mapped to the new rows.
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

  -- Notebooks and decks written by the space creator: names and covers, with their content only when asked.
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
grant execute on function clone_public_space(uuid, boolean, boolean) to authenticated;

-- Marker so the app can tell this migration has been run.
create table if not exists migrations_applied (
  name       text        primary key,
  applied_at timestamptz not null default now()
);
alter table migrations_applied enable row level security;
drop policy if exists "migrations_applied read" on migrations_applied;
create policy "migrations_applied read" on migrations_applied for select to authenticated using (true);
insert into migrations_applied (name) values ('migration-39-shared-items') on conflict (name) do nothing;
