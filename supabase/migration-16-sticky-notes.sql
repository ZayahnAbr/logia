-- ============================================================
-- StudySpace migration 16 — sticky notes on Space home
-- Run this in the Supabase SQL Editor. Private to each user, per space.
-- ============================================================

create table if not exists sticky_notes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references profiles (id) on delete cascade,
  space_id   uuid        not null references spaces (id) on delete cascade,
  body       text        not null default '' check (char_length(body) <= 2000),
  color      text        not null default 'yellow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sticky_notes_space on sticky_notes (user_id, space_id, created_at);

alter table sticky_notes enable row level security;
drop policy if exists "stickies self" on sticky_notes;
create policy "stickies self" on sticky_notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
