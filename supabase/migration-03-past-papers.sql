-- ============================================================
-- StudySpace migration 03 — past paper & worksheet engine
-- Run this in the Supabase SQL Editor.
-- Papers/questions are shared content within a space (same model
-- as active_recall_decks); each user's ATTEMPTS are private.
-- ============================================================

create table past_papers (
  id         uuid        primary key default gen_random_uuid(),
  space_id   uuid        not null references spaces (id) on delete cascade,
  title      text        not null,
  created_by uuid        not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table paper_questions (
  id            uuid        primary key default gen_random_uuid(),
  paper_id      uuid        not null references past_papers (id) on delete cascade,
  space_id      uuid        not null references spaces (id) on delete cascade,
  question_text text        not null,
  memo_answer   text        not null,
  topic         text,
  difficulty    text        not null default 'medium', -- easy | medium | hard
  created_at    timestamptz not null default now()
);

create index on paper_questions (paper_id);
create index on paper_questions (space_id, topic);

create table question_attempts (
  id            uuid        primary key default gen_random_uuid(),
  question_id   uuid        not null references paper_questions (id) on delete cascade,
  user_id       uuid        not null references profiles (id) on delete cascade,
  space_id      uuid        not null references spaces (id) on delete cascade,
  student_answer text       not null,
  is_correct    boolean     not null,
  feedback      text        not null,
  created_at    timestamptz not null default now()
);

create index on question_attempts (user_id, space_id, created_at);
create index on question_attempts (question_id);

alter table past_papers enable row level security;
alter table paper_questions enable row level security;
alter table question_attempts enable row level security;

-- Papers and questions are shared space content — any signed-in user can read/write them,
-- same trust model as active_recall_decks.
create policy "papers read" on past_papers for select using (auth.uid() is not null);
create policy "papers write" on past_papers for insert with check (created_by = auth.uid());
create policy "papers delete own" on past_papers for delete using (created_by = auth.uid());

create policy "paper_questions read" on paper_questions for select using (auth.uid() is not null);
create policy "paper_questions write" on paper_questions for insert with check (auth.uid() is not null);

-- Attempts are private — you can only ever see or write your own.
create policy "attempts self all" on question_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
