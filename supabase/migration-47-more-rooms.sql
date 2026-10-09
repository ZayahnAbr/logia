-- Migration 47: two more Logia rooms (Forest stream, Pine forest). Requires migration 37. Safe to re-run.
alter table public_rooms drop constraint if exists public_rooms_scene_check;
alter table public_rooms add constraint public_rooms_scene_check
  check (scene in ('rain-roof', 'fireside', 'seaside', 'rainforest', 'snowy-forest', 'morning-mist', 'forest-stream', 'conifer-forest'));

alter table user_cafes drop constraint if exists user_cafes_loop_preset_check;
alter table user_cafes add constraint user_cafes_loop_preset_check
  check (loop_preset is null or loop_preset in ('rain-roof', 'fireside', 'seaside', 'rainforest', 'snowy-forest', 'morning-mist', 'forest-stream', 'conifer-forest'));

insert into public_rooms (slug, name, scene, focus_minutes, break_minutes, anchor, is_active, created_at) values
  ('forest-stream', 'Forest stream', 'forest-stream',  25, 5,  timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:07+00'),
  ('pine-forest',   'Pine forest',   'conifer-forest', 50, 10, timestamptz '2024-01-01 00:00:00+00', true, timestamptz '2026-01-01 00:00:08+00')
on conflict (slug) do update set
  name = excluded.name, scene = excluded.scene, focus_minutes = excluded.focus_minutes,
  break_minutes = excluded.break_minutes, anchor = excluded.anchor, is_active = true, created_at = excluded.created_at;
