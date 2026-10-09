-- Migration 43: upload safety (needs to be run; requires 22 and 41, safe to re-run).
--
-- What this does
--  * Every file put into cafe-media, space-widgets, space-headers or notebook-covers is logged (media_uploads) and gets a
--    review row (media_reviews) that starts as 'pending'. A RESTRICTIVE storage policy hides every non-clean file from
--    everyone except the uploader and admins, so a modified browser cannot skip the check: the file is simply not served.
--  * Only the server (which holds MODERATION_SECRET, see migration 41) can mark a file 'clean', through set_media_verdict().
--  * Friction: videos and hosting need a verified email and an account at least 3 days old; per-day upload limits;
--    banned or blocked accounts cannot upload or host. Admins are exempt from friction (not from a ban).
--  * Strikes, 30-day upload blocks, bans, and a restricted evidence table for "Preserve and report".
--
-- Not in this migration: hash matching for known child abuse material. See lib/server/uploadSafety.ts (csamHashHook).
-- Files uploaded before this migration have no review row and stay visible (nothing is hidden retroactively).
--
-- RETENTION: media_uploads rows are kept 12 months, then purge_old_media_uploads() (admin only, run by hand or a cron job)
-- deletes them. media_evidence is never purged automatically.

alter table profiles add column if not exists upload_blocked_until timestamptz;
alter table profiles add column if not exists banned boolean not null default false;

-- Only an admin may change these two columns.
create or replace function profiles_guard_safety() returns trigger language plpgsql as $$
begin
  if (new.banned is distinct from old.banned or new.upload_blocked_until is distinct from old.upload_blocked_until) and not is_logia_admin() then
    raise exception 'Not allowed';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_safety on profiles;
create trigger profiles_guard_safety before update on profiles for each row execute function profiles_guard_safety();

-- ── Tables ────────────────────────────────────────────────────
create table if not exists media_uploads (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  bucket text not null,
  path text not null,
  kind text not null check (kind in ('image', 'video', 'audio', 'other')),
  size bigint,
  created_at timestamptz not null default now(),
  review_status text not null default 'pending',
  unique (bucket, path)
);
create index if not exists media_uploads_user_day on media_uploads (user_id, created_at desc);
alter table media_uploads enable row level security;
drop policy if exists "media_uploads admin read" on media_uploads;
create policy "media_uploads admin read" on media_uploads for select to authenticated using (is_logia_admin());

create table if not exists media_reviews (
  bucket text not null,
  path text not null,
  user_id uuid not null,
  kind text not null,
  status text not null default 'pending' check (status in ('pending', 'clean', 'removed', 'evidence')),
  outcome text not null default 'checking' check (outcome in ('checking', 'unsure', 'unsafe', 'unavailable', 'ok')),
  category text,
  reason text,
  frames jsonb,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  primary key (bucket, path)
);
create index if not exists media_reviews_pending on media_reviews (status, created_at);
alter table media_reviews enable row level security;
drop policy if exists "media_reviews read" on media_reviews;
create policy "media_reviews read" on media_reviews for select to authenticated using (user_id = auth.uid() or is_logia_admin());

create table if not exists user_strikes (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null default 'strike' check (kind in ('strike', 'ban', 'unban')),
  reason text not null,
  content_ref text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists user_strikes_user on user_strikes (user_id, created_at desc);
alter table user_strikes enable row level security;
drop policy if exists "user_strikes admin read" on user_strikes;
create policy "user_strikes admin read" on user_strikes for select to authenticated using (is_logia_admin());

-- Restricted evidence: suspected child abuse material is hidden but the file is kept. Admins only.
create table if not exists media_evidence (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  user_id uuid not null,
  reason text,
  frames jsonb,
  preserved_by uuid,
  preserved_at timestamptz not null default now(),
  reported_at timestamptz
);
alter table media_evidence enable row level security;
drop policy if exists "media_evidence admin read" on media_evidence;
create policy "media_evidence admin read" on media_evidence for select to authenticated using (is_logia_admin());
drop policy if exists "media_evidence admin update" on media_evidence;
create policy "media_evidence admin update" on media_evidence for update to authenticated using (is_logia_admin()) with check (is_logia_admin());

-- ── Helpers ───────────────────────────────────────────────────
create or replace function media_watched(p_bucket text) returns boolean language sql immutable as $$
  select p_bucket in ('cafe-media', 'space-widgets', 'space-headers', 'notebook-covers');
$$;

create or replace function media_kind(p_name text) returns text language sql immutable as $$
  select case
    when lower(p_name) ~ '\.(mp4|webm|mov|m4v)$' then 'video'
    when lower(p_name) ~ '\.(jpe?g|png|webp|gif|avif|heic)$' then 'image'
    when lower(p_name) ~ '\.(mp3|m4a|ogg|wav)$' then 'audio'
    else 'other' end;
$$;

-- Plain-language reason an upload or hosting is not allowed, or null when it is. Admins skip the friction (not a ban).
create or replace function upload_block_reason(p_kind text) returns text
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := auth.uid(); pr record; au record; n int;
begin
  if uid is null then return 'Please sign in again.'; end if;
  select banned, upload_blocked_until into pr from profiles where id = uid;
  if coalesce(pr.banned, false) then return 'This account is suspended.'; end if;
  if is_logia_admin() then return null; end if;
  if pr.upload_blocked_until is not null and pr.upload_blocked_until > now() then
    return 'Uploads are paused on your account until ' || to_char(pr.upload_blocked_until at time zone 'Africa/Johannesburg', 'FMDD Mon YYYY') || '.';
  end if;
  if p_kind = 'video' then
    select email_confirmed_at, created_at into au from auth.users where id = uid;
    if au.email_confirmed_at is null then return 'Confirm your email address first, then you can upload a video.'; end if;
    if au.created_at > now() - interval '3 days' then return 'You can upload videos once your account is 3 days old.'; end if;
  end if;
  if p_kind in ('video', 'image') then
    select count(*) into n from media_uploads where user_id = uid and kind = p_kind and created_at > now() - interval '1 day';
    if p_kind = 'video' and n >= 5 then return 'You have reached today''s limit of 5 videos. Try again tomorrow.'; end if;
    if p_kind = 'image' and n >= 20 then return 'You have reached today''s limit of 20 pictures. Try again tomorrow.'; end if;
  end if;
  return null;
end $$;
grant execute on function upload_block_reason(text) to authenticated;

create or replace function host_block_reason() returns text
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := auth.uid(); pr record; au record;
begin
  if uid is null then return 'Please sign in again.'; end if;
  select banned, upload_blocked_until into pr from profiles where id = uid;
  if coalesce(pr.banned, false) then return 'This account is suspended.'; end if;
  if is_logia_admin() then return null; end if;
  if pr.upload_blocked_until is not null and pr.upload_blocked_until > now() then
    return 'Hosting is paused on your account until ' || to_char(pr.upload_blocked_until at time zone 'Africa/Johannesburg', 'FMDD Mon YYYY') || '.';
  end if;
  select email_confirmed_at, created_at into au from auth.users where id = uid;
  if au.email_confirmed_at is null then return 'Confirm your email address first, then you can host a room.'; end if;
  if au.created_at > now() - interval '3 days' then return 'You can host a room once your account is 3 days old.'; end if;
  return null;
end $$;
grant execute on function host_block_reason() to authenticated;

-- Called by the storage INSERT policy: refuses blocked users, logs the upload and opens its review row.
create or replace function upload_gate(p_bucket text, p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare k text; uid uuid := auth.uid();
begin
  if not media_watched(p_bucket) then return true; end if;
  if uid is null then return false; end if;
  k := media_kind(p_name);
  if upload_block_reason(k) is not null then return false; end if;
  insert into media_uploads (user_id, bucket, path, kind, review_status)
    values (uid, p_bucket, p_name, k, case when k = 'audio' then 'clean' else 'pending' end) on conflict (bucket, path) do nothing;
  insert into media_reviews (bucket, path, user_id, kind, status, outcome)
    values (p_bucket, p_name, uid, k, case when k = 'audio' then 'clean' else 'pending' end, case when k = 'audio' then 'ok' else 'checking' end)
    on conflict (bucket, path) do nothing;
  return true;
end $$;

-- Hidden unless clean (or no review row yet, for older files). The uploader sees their own pending file; admins see all.
create or replace function media_visible(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when not media_watched(p_bucket) then true
    else coalesce((select r.status = 'clean' or is_logia_admin() or (r.user_id = auth.uid() and r.status = 'pending')
                     from media_reviews r where r.bucket = p_bucket and r.path = p_name), true) end;
$$;
grant execute on function media_visible(text, text) to anon, authenticated;

-- ── Storage policies (restrictive: they are ANDed with the existing ones) ──
drop policy if exists "media upload gate" on storage.objects;
create policy "media upload gate" on storage.objects as restrictive for insert to authenticated
  with check (upload_gate(bucket_id, name));
drop policy if exists "media visible only when cleared" on storage.objects;
create policy "media visible only when cleared" on storage.objects as restrictive for select to public
  using (media_visible(bucket_id, name));
drop policy if exists "media admin delete" on storage.objects;
create policy "media admin delete" on storage.objects for delete to authenticated
  using (is_logia_admin() and bucket_id in ('cafe-media', 'space-widgets', 'space-headers', 'notebook-covers'));

-- Hosting needs a verified email, an account 3 days old, and no block.
drop policy if exists "user_cafes host gate" on user_cafes;
create policy "user_cafes host gate" on user_cafes as restrictive for insert to authenticated
  with check (host_block_reason() is null);

-- ── Verdict (server only for 'clean') ─────────────────────────
-- p_outcome: ok (clean, needs the server secret), unsure, unsafe, unavailable. One verdict per file, except that a check
-- which could not run may be retried. A flagged file never goes back to clean this way: an admin decides.
create or replace function set_media_verdict(p_bucket text, p_path text, p_outcome text, p_category text, p_reason text,
                                              p_frames jsonb, p_secret text) returns text
language plpgsql security definer set search_path = public as $$
declare r media_reviews; stored text; sz bigint;
begin
  select * into r from media_reviews where bucket = p_bucket and path = p_path and (user_id = auth.uid() or is_logia_admin());
  if not found then raise exception 'Not found'; end if;
  if r.status <> 'pending' or r.outcome not in ('checking', 'unavailable') then return r.status; end if;
  if p_outcome not in ('ok', 'unsure', 'unsafe', 'unavailable') then p_outcome := 'unavailable'; end if;
  if p_outcome = 'ok' then
    select secret_hash into stored from moderation_config where id = 1;
    if stored is null or p_secret is null or encode(sha256(convert_to(p_secret, 'utf8')), 'hex') <> stored then
      p_outcome := 'unavailable'; p_reason := 'The check could not be confirmed';
    end if;
  end if;
  begin select (metadata ->> 'size')::bigint into sz from storage.objects where bucket_id = p_bucket and name = p_path; exception when others then sz := null; end;
  if p_outcome = 'ok' then
    update media_reviews set status = 'clean', outcome = 'ok', checked_at = now(), frames = null where bucket = p_bucket and path = p_path;
    update media_uploads set review_status = 'clean', size = coalesce(sz, size) where bucket = p_bucket and path = p_path;
    return 'clean';
  end if;
  update media_reviews set outcome = p_outcome, category = left(p_category, 80), reason = left(p_reason, 200), checked_at = now(),
         frames = case when jsonb_typeof(p_frames) = 'array' and jsonb_array_length(p_frames) <= 8 then p_frames else null end
   where bucket = p_bucket and path = p_path;
  update media_uploads set size = coalesce(sz, size) where bucket = p_bucket and path = p_path;
  return 'pending';
end $$;
grant execute on function set_media_verdict(text, text, text, text, text, jsonb, text) to authenticated;

-- A server-side copy of a file that was already visible to the copier inherits "clean" (clones, placing a saved sticker).
create or replace function inherit_media_review(p_bucket text, p_src text, p_dest text) returns void
language plpgsql security definer set search_path = public as $$
declare s media_reviews;
begin
  select * into s from media_reviews where bucket = p_bucket and path = p_src;
  if found and s.status <> 'clean' then return; end if;
  update media_reviews set status = 'clean', outcome = 'ok', checked_at = now() where bucket = p_bucket and path = p_dest and user_id = auth.uid() and status = 'pending';
  update media_uploads set review_status = 'clean' where bucket = p_bucket and path = p_dest and user_id = auth.uid() and review_status = 'pending';
end $$;
grant execute on function inherit_media_review(text, text, text) to authenticated;

-- Status of several files for the signed-in user (own files) or any reader: 'clean' | 'pending' | 'unsafe' | 'removed'.
create or replace function media_states(p_bucket text, p_paths text[]) returns table (path text, state text)
language sql stable security definer set search_path = public as $$
  select p, coalesce((select case when r.status = 'clean' then 'clean' when r.status in ('removed', 'evidence') then 'removed'
                                  when r.outcome = 'unsafe' then 'unsafe' else 'pending' end
                        from media_reviews r where r.bucket = p_bucket and r.path = p), 'clean')
    from unnest(p_paths) p;
$$;
grant execute on function media_states(text, text[]) to anon, authenticated;

-- ── Admin ─────────────────────────────────────────────────────
create or replace function admin_pending_media() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at) from (
    select r.bucket, r.path, r.kind, r.outcome, r.category, r.reason, r.frames, r.created_at, r.user_id,
           (select email from auth.users u where u.id = r.user_id) as email,
           (select count(*) from user_strikes s where s.user_id = r.user_id and s.kind = 'strike') as strikes
      from media_reviews r
     where r.status = 'pending' and (r.outcome <> 'checking' or r.created_at < now() - interval '10 minutes')
     order by r.created_at limit 60) x), '[]'::jsonb);
end $$;
grant execute on function admin_pending_media() to authenticated;

create or replace function apply_strike(p_user uuid, p_reason text, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  insert into user_strikes (user_id, kind, reason, content_ref, created_by) values (p_user, 'strike', left(p_reason, 300), p_ref, auth.uid());
  select count(*) into n from user_strikes where user_id = p_user and kind = 'strike';
  if n >= 3 then update profiles set banned = true where id = p_user;
  elsif n = 2 then update profiles set upload_blocked_until = now() + interval '30 days' where id = p_user; end if;
  return jsonb_build_object('strikes', n, 'banned', n >= 3, 'blocked', n = 2);
end $$;
revoke all on function apply_strike(uuid, text, text) from public;

-- p_action: approve | remove | strike | preserve
create or replace function admin_media_action(p_bucket text, p_path text, p_action text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r media_reviews; res jsonb := '{}'::jsonb;
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  select * into r from media_reviews where bucket = p_bucket and path = p_path;
  if not found then raise exception 'Not found'; end if;
  if p_action = 'approve' then
    update media_reviews set status = 'clean', outcome = 'ok', reviewed_by = auth.uid(), reviewed_at = now() where bucket = p_bucket and path = p_path;
    update media_uploads set review_status = 'clean' where bucket = p_bucket and path = p_path;
  elsif p_action in ('remove', 'strike') then
    update media_reviews set status = 'removed', reviewed_by = auth.uid(), reviewed_at = now() where bucket = p_bucket and path = p_path;
    update media_uploads set review_status = 'removed' where bucket = p_bucket and path = p_path;
    if p_action = 'strike' then res := apply_strike(r.user_id, coalesce(nullif(p_note, ''), 'Upload removed: ' || coalesce(r.category, 'policy')), p_bucket || '/' || p_path); end if;
  elsif p_action = 'preserve' then
    update media_reviews set status = 'evidence', reviewed_by = auth.uid(), reviewed_at = now() where bucket = p_bucket and path = p_path;
    update media_uploads set review_status = 'evidence' where bucket = p_bucket and path = p_path;
    insert into media_evidence (bucket, path, user_id, reason, frames, preserved_by) values (p_bucket, p_path, r.user_id, left(p_note, 300), r.frames, auth.uid());
    insert into user_strikes (user_id, kind, reason, content_ref, created_by) values (r.user_id, 'strike', 'Suspected child abuse material (preserved)', p_bucket || '/' || p_path, auth.uid());
    update profiles set banned = true where id = r.user_id;
    res := jsonb_build_object('banned', true);
  else raise exception 'Unknown action';
  end if;
  return res;
end $$;
grant execute on function admin_media_action(text, text, text, text) to authenticated;

create or replace function admin_user_lookup(p_email text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare u record; pr record;
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  select id, email from auth.users where lower(email) = lower(btrim(p_email)) into u;
  if u.id is null then return null; end if;
  select banned, upload_blocked_until into pr from profiles where id = u.id;
  return jsonb_build_object('id', u.id, 'email', u.email, 'banned', coalesce(pr.banned, false), 'blockedUntil', pr.upload_blocked_until,
    'strikes', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'reason', s.reason, 'ref', s.content_ref, 'at', s.created_at) order by s.created_at desc)
                          from user_strikes s where s.user_id = u.id), '[]'::jsonb));
end $$;
grant execute on function admin_user_lookup(text) to authenticated;

create or replace function admin_set_ban(p_user uuid, p_banned boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  update profiles set banned = p_banned, upload_blocked_until = case when p_banned then upload_blocked_until else null end where id = p_user;
  insert into user_strikes (user_id, kind, reason, created_by) values (p_user, case when p_banned then 'ban' else 'unban' end, left(coalesce(nullif(p_reason, ''), 'Set by an admin'), 300), auth.uid());
end $$;
grant execute on function admin_set_ban(uuid, boolean, text) to authenticated;

-- Own state for the sign-in gate (banned users see the suspended page).
create or replace function my_account_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('banned', coalesce((select banned from profiles where id = auth.uid()), false));
$$;
grant execute on function my_account_state() to authenticated;

create or replace function purge_old_media_uploads() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_logia_admin() then raise exception 'Admins only'; end if;
  delete from media_uploads where created_at < now() - interval '12 months';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function purge_old_media_uploads() to authenticated;

insert into migrations_applied (name) values ('migration-43-upload-safety') on conflict do nothing;
