-- ============================================================
-- Logia migration 37: real filmed loops (Mixkit) replace the old four scenes
-- Requires migrations 22 and 23. Run in the Supabase SQL Editor. Safe to re-run.
-- Scene ids: rain-roof, fireside, seaside, rainforest, snowy-forest, morning-mist
-- ============================================================

-- ── Official rooms (public_rooms) ─────────────────────────────
-- Widen the scene check, and give the four retired rooms a new-style scene so the check holds.
alter table public_rooms drop constraint if exists public_rooms_scene_check;
update public_rooms set scene = case scene
  when 'rain-cafe'     then 'rain-roof'
  when 'night-library' then 'fireside'
  when 'forest-cabin'  then 'fireside'
  when 'lofi-desk'     then 'rainforest'
  else scene end
 where scene in ('rain-cafe', 'night-library', 'forest-cabin', 'lofi-desk');
alter table public_rooms add constraint public_rooms_scene_check
  check (scene in ('rain-roof', 'fireside', 'seaside', 'rainforest', 'snowy-forest', 'morning-mist'));

-- Fixed anchor so cycles line up with the clock (:00 / :30 for 25+5, on the hour for 50+10).
-- created_at fixes the order on Discover.
insert into public_rooms (slug, name, scene, focus_minutes, break_minutes, anchor, is_active, created_at) values
  ('rainy-day',    'Rainy day',    'rain-roof',    25, 5,  timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:01+00'),
  ('fireside',     'Fireside',     'fireside',     50, 10, timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:02+00'),
  ('seaside',      'Seaside',      'seaside',      25, 5,  timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:03+00'),
  ('rainforest',   'Rainforest',   'rainforest',   50, 10, timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:04+00'),
  ('snowy-forest', 'Snowy forest', 'snowy-forest', 25, 5,  timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:05+00'),
  ('morning-mist', 'Morning mist', 'morning-mist', 50, 10, timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:06+00')
on conflict (slug) do update set
  name = excluded.name, scene = excluded.scene,
  focus_minutes = excluded.focus_minutes, break_minutes = excluded.break_minutes,
  anchor = excluded.anchor, is_active = true, created_at = excluded.created_at;

-- The old rooms are deactivated, not deleted: cafe_messages.room_id references them
-- (on delete cascade would wipe their chat history). The app hides inactive rooms and
-- sends their old links to /discover.
update public_rooms set is_active = false
 where slug not in ('rainy-day', 'fireside', 'seaside', 'rainforest', 'snowy-forest', 'morning-mist');

-- ── Hosted rooms (user_cafes, migration 23) ───────────────────
alter table user_cafes drop constraint if exists user_cafes_loop_preset_check;
update user_cafes set loop_preset = case loop_preset
  when 'rain-cafe'     then 'rain-roof'
  when 'night-library' then 'fireside'
  when 'forest-cabin'  then 'fireside'
  when 'lofi-desk'     then 'rainforest'
  else loop_preset end
 where loop_preset in ('rain-cafe', 'night-library', 'forest-cabin', 'lofi-desk');
alter table user_cafes add constraint user_cafes_loop_preset_check
  check (loop_preset is null or loop_preset in ('rain-roof', 'fireside', 'seaside', 'rainforest', 'snowy-forest', 'morning-mist'));
