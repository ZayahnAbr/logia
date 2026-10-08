-- ============================================================
-- StudySpace migration 02 — per-user review schedule
-- Run this in the Supabase SQL Editor AFTER the first migration.
-- Card CONTENT is shared (active_recall_decks.cards_json); each
-- user's SCHEDULE is private and lives here.
-- ============================================================

create table card_reviews (
  user_id    uuid        not null references profiles (id) on delete cascade,
  card_id    text        not null,                     -- matches the id in cards_json
  deck_id    uuid        not null references active_recall_decks (deck_id) on delete cascade,
  space_id   uuid        not null references spaces (id) on delete cascade,
  ladder_idx int         not null default 0,
  reps       int         not null default 0,
  lapses     int         not null default 0,
  due        timestamptz not null default now(),
  last_rated text,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create index on card_reviews (user_id, space_id, due);

alter table card_reviews enable row level security;

-- You can only ever see or change your own review schedule.
create policy "reviews self all" on card_reviews
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
