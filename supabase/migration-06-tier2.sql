-- ============================================================
-- StudySpace migration 06 — Tier 2: collaborative deck upvotes
-- Run this in the Supabase SQL Editor.
-- ============================================================

create table card_votes (
  deck_id    uuid        not null references active_recall_decks (deck_id) on delete cascade,
  card_id    text        not null,
  user_id    uuid        not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

create index on card_votes (deck_id);

alter table card_votes enable row level security;

-- Votes are shared space content — any signed-in user can read all votes on a deck,
-- but can only cast/change their own.
create policy "votes read" on card_votes for select using (auth.uid() is not null);
create policy "votes self write" on card_votes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
