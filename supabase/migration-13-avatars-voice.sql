-- ============================================================
-- StudySpace migration 13 — custom avatars + voice in study rooms
-- Run this in the Supabase SQL Editor (after migration 12).
-- ============================================================

-- Avatar: a colour swatch + either initials or a small symbol.
alter table profiles add column if not exists avatar_color text;
alter table profiles add column if not exists avatar_icon  text;

-- Chat shows the sender's avatar as it was when they sent the message.
alter table room_messages add column if not exists author_color text;
alter table room_messages add column if not exists author_icon  text;

-- Rooms can offer voice chat (audio goes peer-to-peer; nothing is recorded or stored).
alter table study_rooms add column if not exists voice_enabled boolean not null default true;
