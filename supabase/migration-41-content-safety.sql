-- ============================================================
-- Logia migration 41: content safety (word filter, pre-publish check, review queue) and space tags
-- Requires migrations 22 and 39. Run in the Supabase SQL Editor. Safe to re-run.
--
-- 1. blocked_terms + triggers: text people can read from each other is rejected by the database when it matches.
-- 2. spaces.public_status + moderation_reports + publish_space(): a space can only become public through the
--    publish function, which needs a server-side secret, so the browser cannot skip the check.
-- 3. spaces.tags / institution / level, and the Discover list function with filters.
--
-- AFTER RUNNING: pick a long random string, set it as MODERATION_SECRET in the app's server environment, and store its
-- hash here (replace the text, run once):
--   update moderation_config set secret_hash = encode(sha256(convert_to('YOUR-LONG-RANDOM-SECRET', 'utf8')), 'hex') where id = 1;
-- Until that is done, no space can be made public automatically: every request waits in the admin review queue.
-- ============================================================

-- ── Blocked terms (admin editable) ────────────────────────────
create table if not exists blocked_terms (
  term       text primary key check (term = lower(term) and term ~ '^[a-z]{2,40}$'),
  mode       text not null default 'word' check (mode in ('word', 'stem', 'exact')),
  created_at timestamptz not null default now()
);
alter table blocked_terms enable row level security;
drop policy if exists "blocked_terms admin" on blocked_terms;
create policy "blocked_terms admin" on blocked_terms for all to authenticated
  using (is_logia_admin()) with check (is_logia_admin());

-- Seeded from BLOCKED_WORDS in lib/moderation.ts. The South African entries need review by native speakers.
insert into blocked_terms (term, mode) values
  ('shit', 'word'), ('bitch', 'word'), ('bastard', 'word'), ('asshole', 'word'), ('dick', 'word'), ('dickhead', 'word'),
  ('piss', 'exact'), ('slut', 'word'), ('whore', 'word'), ('retard', 'word'), ('kys', 'exact'), ('twat', 'word'),
  ('wanker', 'word'), ('cock', 'exact'), ('prick', 'word'), ('fuck', 'stem'), ('motherfuck', 'stem'), ('bullshit', 'stem'),
  ('cunt', 'stem'), ('nigger', 'stem'), ('nigga', 'stem'), ('faggot', 'stem'), ('kaffir', 'word'), ('kaffer', 'word'),
  ('hotnot', 'word'), ('coolie', 'word'), ('koelie', 'word'), ('houtkop', 'word'), ('boesman', 'word'), ('isitabane', 'word'),
  ('poes', 'exact'), ('naai', 'exact'), ('fok', 'exact'), ('fokken', 'exact'), ('fokof', 'exact'), ('doos', 'exact'),
  ('hoer', 'exact'), ('piel', 'exact'), ('kont', 'exact'), ('kak', 'exact'), ('teef', 'exact'), ('isifebe', 'word'),
  ('ikhaba', 'word'), ('umthondo', 'word'), ('isidwedwe', 'word'), ('sfebe', 'exact'), ('sethotsela', 'word'), ('mmago', 'exact')
on conflict (term) do nothing;

-- Lower case, accents removed, leetspeak undone, everything but letters becomes a space.
create or replace function norm_text(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
    translate(translate(lower(coalesce(t, '')), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '013457@$!', 'oieastasi'),
    '[^a-z]+', ' ', 'g'));
$$;

create or replace function text_is_blocked(t text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare tok text; sq text;
begin
  if t is null or t = '' then return false; end if;
  for tok in select unnest(string_to_array(norm_text(t), ' ')) loop
    if tok = '' then continue; end if;
    sq := regexp_replace(tok, '(.)\1+', '\1', 'g');
    if exists (
      select 1 from blocked_terms b
       where (b.mode = 'exact' and b.term = tok)
          or (b.mode = 'word' and sq ~ ('^' || regexp_replace(b.term, '(.)\1+', '\1', 'g') || '(s|es|ed|er|ers|ing|y|ie|head)?$'))
          or (b.mode = 'stem' and sq like regexp_replace(b.term, '(.)\1+', '\1', 'g') || '%')
    ) then return true; end if;
  end loop;
  return false;
end $$;
grant execute on function text_is_blocked(text) to authenticated;

-- Rejects an insert or update whose named columns match. Arguments: the column names to check.
-- Only columns that changed are checked on update, so old rows never block unrelated edits.
create or replace function reject_blocked_text() returns trigger
language plpgsql security definer set search_path = public as $$
declare col text; n jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  foreach col in array tg_argv loop
    if (n ->> col) is not null and (tg_op = 'INSERT' or (n ->> col) is distinct from (o ->> col)) then
      if text_is_blocked(n ->> col) then raise exception 'blocked_text' using errcode = 'P0001'; end if;
    end if;
  end loop;
  return new;
end $$;

-- Display names: signing up goes through an automatic profile insert, so a bad name is replaced instead of failing the sign-up.
create or replace function clean_display_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is not null and text_is_blocked(new.display_name) then
    if tg_op = 'INSERT' then new.display_name := 'Student'; else raise exception 'blocked_text' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

-- Tags on spaces (also used by the Discover filters).
alter table spaces add column if not exists tags text[] not null default '{}';
alter table spaces add column if not exists institution text;
alter table spaces add column if not exists level text;
alter table spaces drop constraint if exists spaces_level_check;
alter table spaces add constraint spaces_level_check
  check (level is null or level in ('high school', 'first year', 'second year', 'third year', 'honours', 'postgrad', 'other'));

create or replace function tags_valid(t text[]) returns boolean
language sql immutable as $$
  select coalesce(cardinality(t), 0) <= 6
     and not exists (select 1 from unnest(t) x where x is null or x !~ '^[a-z0-9][a-z0-9 -]{0,22}[a-z0-9]$');
$$;
alter table spaces drop constraint if exists spaces_tags_check;
alter table spaces add constraint spaces_tags_check check (tags_valid(tags));
alter table spaces drop constraint if exists spaces_institution_check;
alter table spaces add constraint spaces_institution_check check (institution is null or char_length(institution) between 2 and 60);
create index if not exists spaces_tags_gin on spaces using gin (tags);

create or replace function spaces_text_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
declare col text; n jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  foreach col in array array['name', 'subject', 'public_description', 'institution'] loop
    if (n ->> col) is not null and (tg_op = 'INSERT' or (n ->> col) is distinct from (o ->> col)) and text_is_blocked(n ->> col) then
      raise exception 'blocked_text' using errcode = 'P0001';
    end if;
  end loop;
  if (tg_op = 'INSERT' or new.tags is distinct from old.tags) and text_is_blocked(array_to_string(new.tags, ' ')) then
    raise exception 'blocked_text' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Attach the triggers. Each is skipped if its table does not exist on this database.
do $$
declare spec record;
begin
  for spec in select * from (values
    ('cafe_messages', 'body'), ('room_messages', 'body'), ('study_rooms', 'title,goal'), ('user_cafes', 'name,description')
  ) as v(tbl, cols) loop
    if to_regclass('public.' || spec.tbl) is not null then
      execute format('drop trigger if exists blocked_text_t on %I', spec.tbl);
      execute format('create trigger blocked_text_t before insert or update on %I for each row execute function reject_blocked_text(%s)',
                     spec.tbl, (select string_agg(quote_literal(c), ',') from unnest(string_to_array(spec.cols, ',')) c));
    end if;
  end loop;
end $$;

drop trigger if exists clean_display_name_t on profiles;
create trigger clean_display_name_t before insert or update on profiles for each row execute function clean_display_name();
drop trigger if exists spaces_text_blocked_t on spaces;
create trigger spaces_text_blocked_t before insert or update on spaces for each row execute function spaces_text_blocked();

-- ── Public status, scan results and the only publish path ─────
alter table spaces add column if not exists public_status text not null default 'private';
alter table spaces drop constraint if exists spaces_public_status_check;
alter table spaces add constraint spaces_public_status_check check (public_status in ('private', 'pending', 'public', 'rejected'));
alter table spaces add column if not exists last_scan_at timestamptz;
alter table spaces add column if not exists rescan_due timestamptz;
-- Spaces that were already public when this ran stay public; they are re-checked the next time their owner opens them.
update spaces set public_status = 'public' where is_public and public_status = 'private';

create table if not exists moderation_config (
  id          int primary key check (id = 1),
  secret_hash text
);
insert into moderation_config (id) values (1) on conflict do nothing;
alter table moderation_config enable row level security; -- no policies: only the functions below read it

create table if not exists moderation_reports (
  id          uuid        primary key default gen_random_uuid(),
  space_id    uuid        not null references spaces (id) on delete cascade,
  kind        text        not null check (kind in ('text', 'image', 'system')),
  item_ref    text        not null,
  reason      text        not null,
  created_at  timestamptz not null default now(),
  resolved_by uuid        references profiles (id) on delete set null,
  resolved_at timestamptz
);
create index if not exists moderation_reports_open on moderation_reports (space_id) where resolved_at is null;
alter table moderation_reports enable row level security;
drop policy if exists "moderation_reports admin read" on moderation_reports;
create policy "moderation_reports admin read" on moderation_reports for select to authenticated using (is_logia_admin());
drop policy if exists "moderation_reports admin update" on moderation_reports;
create policy "moderation_reports admin update" on moderation_reports for update to authenticated
  using (is_logia_admin()) with check (is_logia_admin());

-- A space may only become public inside publish_space() / admin_review_space(), which set this flag for the transaction.
create or replace function spaces_guard_public() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('logia.publishing', true), '') = 'on' then return new; end if;
  if (tg_op = 'INSERT' and (new.is_public or new.public_status = 'public'))
     or (tg_op = 'UPDATE' and ((new.is_public and not old.is_public) or (new.public_status = 'public' and old.public_status <> 'public'))) then
    raise exception 'A space can only be made public after it has been checked.';
  end if;
  -- Nobody can lift a space out of review or rejection by editing the row.
  if tg_op = 'UPDATE' and new.public_status is distinct from old.public_status
     and not (new.public_status = 'private' and old.public_status in ('public', 'pending')) then
    raise exception 'A space can only be made public after it has been checked.';
  end if;
  if tg_op = 'UPDATE' and old.is_public and (new.name is distinct from old.name or new.public_description is distinct from old.public_description
      or new.tags is distinct from old.tags or new.header_kind is distinct from old.header_kind
      or new.header_image_path is distinct from old.header_image_path or new.header_color is distinct from old.header_color) then
    new.rescan_due := now() + interval '5 minutes';
  end if;
  return new;
end $$;
drop trigger if exists spaces_guard_public_t on spaces;
create trigger spaces_guard_public_t before insert or update on spaces for each row execute function spaces_guard_public();

-- Changes to a public space's stickers or shared items ask for a re-check a few minutes later (debounced).
create or replace function mark_rescan() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce((to_jsonb(new) ->> 'space_id')::uuid, (to_jsonb(old) ->> 'space_id')::uuid);
begin
  update spaces set rescan_due = now() + interval '5 minutes' where id = sid and is_public;
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['space_widgets', 'space_shared_items'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists mark_rescan_t on %I', t);
      execute format('create trigger mark_rescan_t after insert or update or delete on %I for each row execute function mark_rescan()', t);
    end if;
  end loop;
end $$;

-- Unpublishing and editing the public details stay with the creator; publishing is closed here.
create or replace function set_space_public(p_space_id uuid, p_public boolean, p_description text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_public then raise exception 'A space can only be made public after it has been checked.'; end if;
  update spaces set is_public = false, public_status = case when public_status in ('public', 'pending') then 'private' else public_status end, rescan_due = null,
         public_description = coalesce(nullif(left(trim(coalesce(p_description, '')), 280), ''), public_description)
   where id = p_space_id and created_by = auth.uid();
  if not found then raise exception 'Only the creator of a space can change this.'; end if;
  update moderation_reports set resolved_at = now() where space_id = p_space_id and resolved_at is null;
end $$;
grant execute on function set_space_public(uuid, boolean, text) to authenticated;

-- The publish path. p_verdict: 'clean' (needs the server secret), 'pending' (waits for an admin), 'private' (not published).
-- p_items: [{kind, ref, reason}] shown to admins for 'pending'.
create or replace function publish_space(p_space uuid, p_description text, p_tags text[], p_institution text, p_level text,
                                         p_verdict text, p_items jsonb, p_secret text) returns text
language plpgsql security definer set search_path = public as $$
declare sp spaces; stored text; it jsonb; tg text[];
begin
  select * into sp from spaces where id = p_space and created_by = auth.uid();
  if not found then raise exception 'Only the creator of a space can change this.'; end if;
  tg := coalesce((select array_agg(distinct lower(btrim(x))) from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> ''), '{}');
  update spaces set public_description = nullif(left(trim(coalesce(p_description, '')), 280), ''), tags = tg,
         institution = nullif(left(btrim(coalesce(p_institution, '')), 60), ''), level = nullif(p_level, '')
   where id = p_space;

  if p_verdict = 'clean' then
    select secret_hash into stored from moderation_config where id = 1;
    if stored is null or p_secret is null or encode(sha256(convert_to(p_secret, 'utf8')), 'hex') <> stored then
      p_verdict := 'pending'; p_items := '[{"kind":"system","ref":"check","reason":"The automatic check could not be confirmed."}]'::jsonb;
    end if;
  end if;

  perform set_config('logia.publishing', 'on', true);
  if p_verdict = 'clean' then
    update spaces set is_public = true, public_status = 'public', last_scan_at = now(), rescan_due = null where id = p_space;
    update moderation_reports set resolved_at = now() where space_id = p_space and resolved_at is null;
    return 'public';
  elsif p_verdict = 'pending' then
    update spaces set is_public = false, public_status = 'pending', rescan_due = null where id = p_space;
    update moderation_reports set resolved_at = now() where space_id = p_space and resolved_at is null;
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 40 loop
      insert into moderation_reports (space_id, kind, item_ref, reason)
      values (p_space, case when it ->> 'kind' in ('text', 'image') then it ->> 'kind' else 'system' end,
              left(coalesce(it ->> 'ref', ''), 300), left(coalesce(it ->> 'reason', ''), 300));
    end loop;
    return 'pending';
  end if;
  return sp.public_status;
end $$;
grant execute on function publish_space(uuid, text, text[], text, text, text, jsonb, text) to authenticated;

-- A re-check result for a space that is already public. clean: stays public. pending: moves to review, nothing deleted.
-- Same secret rule as above (a 'clean' with a wrong secret leaves the space as it is).
create or replace function record_rescan(p_space uuid, p_verdict text, p_items jsonb, p_secret text) returns text
language plpgsql security definer set search_path = public as $$
declare sp spaces; stored text; it jsonb;
begin
  select * into sp from spaces where id = p_space and created_by = auth.uid() and is_public;
  if not found then return 'none'; end if;
  perform set_config('logia.publishing', 'on', true);
  if p_verdict = 'clean' then
    select secret_hash into stored from moderation_config where id = 1;
    if stored is not null and p_secret is not null and encode(sha256(convert_to(p_secret, 'utf8')), 'hex') = stored then
      update spaces set last_scan_at = now(), rescan_due = null where id = p_space;
      return 'public';
    end if;
    return 'public';
  elsif p_verdict = 'pending' then
    update spaces set is_public = false, public_status = 'pending', rescan_due = null where id = p_space;
    update moderation_reports set resolved_at = now() where space_id = p_space and resolved_at is null;
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 40 loop
      insert into moderation_reports (space_id, kind, item_ref, reason)
      values (p_space, case when it ->> 'kind' in ('text', 'image') then it ->> 'kind' else 'system' end,
              left(coalesce(it ->> 'ref', ''), 300), left(coalesce(it ->> 'reason', ''), 300));
    end loop;
    return 'pending';
  end if;
  update spaces set rescan_due = now() + interval '1 hour' where id = p_space; -- could not run: try again later
  return 'public';
end $$;
grant execute on function record_rescan(uuid, text, jsonb, text) to authenticated;

-- Claims a due re-check so two tabs do not both run it. True means: run it now.
create or replace function claim_rescan(p_space uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update spaces set rescan_due = null, last_scan_at = coalesce(last_scan_at, now() - interval '2 days')
   where id = p_space and created_by = auth.uid() and is_public
     and ((rescan_due is not null and rescan_due <= now()) or last_scan_at is null or last_scan_at < now() - interval '24 hours');
  return found;
end $$;
grant execute on function claim_rescan(uuid) to authenticated;

-- What the owner's dialog shows.
create or replace function my_space_public_state(p_space uuid)
returns table (public_status text, tags text[], institution text, level text)
language sql stable security definer set search_path = public as $$
  select s.public_status, s.tags, s.institution, s.level from spaces s where s.id = p_space and s.created_by = auth.uid();
$$;
grant execute on function my_space_public_state(uuid) to authenticated;

-- ── Admin review queue ────────────────────────────────────────
create or replace function admin_pending_spaces()
returns table (space_id uuid, name text, owner_name text, public_description text, tags text[], reports jsonb, requested_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  return query
    select s.id, s.name, coalesce(nullif(btrim(p.display_name), ''), 'A Logia student'), s.public_description, s.tags,
           coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'ref', r.item_ref, 'reason', r.reason) order by r.created_at)
                       from moderation_reports r where r.space_id = s.id and r.resolved_at is null), '[]'::jsonb),
           coalesce((select max(r.created_at) from moderation_reports r where r.space_id = s.id), s.created_at)
      from spaces s left join profiles p on p.id = s.created_by
     where s.public_status = 'pending' order by 7;
end $$;
grant execute on function admin_pending_spaces() to authenticated;

create or replace function admin_review_space(p_space uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  perform set_config('logia.publishing', 'on', true);
  if p_approve then
    update spaces set is_public = true, public_status = 'public', last_scan_at = now(), rescan_due = null where id = p_space and public_status = 'pending';
  else
    update spaces set is_public = false, public_status = 'rejected', rescan_due = null where id = p_space and public_status = 'pending';
  end if;
  update moderation_reports set resolved_by = auth.uid(), resolved_at = now() where space_id = p_space and resolved_at is null;
end $$;
grant execute on function admin_review_space(uuid, boolean) to authenticated;

-- ── Discover: filtered list of public spaces ──────────────────
-- Returns only public, non-hidden spaces and only their public fields. Copies are counted from space_clone_log when it exists.
create or replace function discover_spaces(p_q text default null, p_tags text[] default null, p_level text default null,
                                           p_institution text default null, p_sort text default 'members')
returns table (id uuid, name text, subject text, public_description text, member_count bigint, created_at timestamptz,
               tags text[], institution text, level text, copy_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare mt text; q text := nullif(btrim(coalesce(p_q, '')), ''); sql text;
begin
  if auth.uid() is null then return; end if;
  select c.table_name into mt
    from information_schema.columns c
    join information_schema.columns u on u.table_schema = c.table_schema and u.table_name = c.table_name and u.column_name = 'user_id'
   where c.table_schema = 'public' and c.column_name = 'space_id' and c.table_name ilike '%member%'
   order by (c.table_name = 'space_members') desc limit 1;
  sql := format($f$
    select s.id, s.name, s.subject, s.public_description, %s, s.created_at, s.tags, s.institution, s.level,
           %s
      from spaces s
     where s.is_public and not coalesce(s.hidden, false)
       and ($1 is null or s.name ilike '%%' || $1 || '%%' or s.public_description ilike '%%' || $1 || '%%' or s.subject ilike '%%' || $1 || '%%'
            or exists (select 1 from unnest(s.tags) t where t ilike '%%' || $1 || '%%'))
       and ($2 is null or cardinality($2) = 0 or s.tags @> $2)
       and ($3 is null or s.level = $3)
       and ($4 is null or lower(s.institution) = lower($4))
     order by %s limit 200$f$,
    case when mt is null then '1::bigint' else format('(select count(*) from %I m where m.space_id = s.id)::bigint', mt) end,
    case when to_regclass('public.space_clone_log') is null then '0::bigint'
         else '(select count(*) from space_clone_log l where l.source = s.id)::bigint' end,
    case p_sort when 'newest' then 's.created_at desc'
                when 'copied' then '10 desc, s.created_at desc'
                else '5 desc, s.created_at desc' end);
  return query execute sql using q, p_tags, nullif(p_level, ''), nullif(btrim(coalesce(p_institution, '')), '');
end $$;
grant execute on function discover_spaces(text, text[], text, text, text) to authenticated;

-- Tag counts for the filter chips (public, non-hidden spaces only).
create or replace function discover_space_facets()
returns table (kind text, value text, n bigint)
language sql stable security definer set search_path = public as $$
  select 'tag', t, count(*) from spaces s, unnest(s.tags) t where auth.uid() is not null and s.is_public and not coalesce(s.hidden, false) group by t
  union all
  select 'institution', s.institution, count(*) from spaces s where auth.uid() is not null and s.is_public and not coalesce(s.hidden, false) and s.institution is not null group by s.institution
  union all
  select 'level', s.level, count(*) from spaces s where auth.uid() is not null and s.is_public and not coalesce(s.hidden, false) and s.level is not null group by s.level;
$$;
grant execute on function discover_space_facets() to authenticated;

insert into migrations_applied (name) values ('migration-41-content-safety') on conflict (name) do nothing;
