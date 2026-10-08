-- ============================================================
-- StudySpace migration 09 — practice quizzes, pain points,
-- deck language tags, onboarding persona.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- Practice quiz scores, per deck.
create table quiz_attempts (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references profiles (id) on delete cascade,
  deck_id    uuid        not null references active_recall_decks (deck_id) on delete cascade,
  space_id   uuid        not null references spaces (id) on delete cascade,
  score      int         not null,
  total      int         not null,
  created_at timestamptz not null default now()
);
create index on quiz_attempts (user_id, deck_id, created_at);
alter table quiz_attempts enable row level security;
create policy "quiz self all" on quiz_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Pain points: a private running log of the things a student keeps getting wrong.
create table pain_points (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references profiles (id) on delete cascade,
  space_id    uuid        not null references spaces (id) on delete cascade,
  title       text        not null,
  description text        not null default '',
  topic       text,
  hits        int         not null default 1,
  source      text        not null default 'manual', -- manual | paper | flashcard
  note_id     uuid,
  resolved    boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on pain_points (user_id, space_id, resolved);
alter table pain_points enable row level security;
create policy "pain self all" on pain_points
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Language tags on decks (ISO 639-1), used for text-to-speech.
alter table active_recall_decks
  add column if not exists front_language text not null default 'en',
  add column if not exists back_language  text not null default 'en';

-- Why the student uses Logia — seeds recommendations.
alter table profiles
  add column if not exists persona text;
