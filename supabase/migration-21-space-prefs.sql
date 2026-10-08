-- ============================================================
-- StudySpace migration 21 — personal space preferences (cover colour)
-- Run this in the Supabase SQL Editor. Each person picks their own colours,
-- so members of a shared space don't overwrite each other.
-- ============================================================

create table if not exists space_prefs (
  user_id     uuid not null references profiles (id) on delete cascade,
  space_id    uuid not null references spaces (id) on delete cascade,
  cover_color text check (cover_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at  timestamptz not null default now(),
  primary key (user_id, space_id)
);

alter table space_prefs enable row level security;
drop policy if exists "space prefs self" on space_prefs;
create policy "space prefs self" on space_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
