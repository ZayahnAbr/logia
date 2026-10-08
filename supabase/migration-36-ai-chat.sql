-- ============================================================
-- Logia migration 36: saved Ask AI chat history (private to each student)
-- No dependencies beyond profiles, spaces and notes. Run in the Supabase SQL Editor. Safe to re-run.
-- One row per message. surface 'space' is the Ask AI page (note_id null); 'note' is the Ask panel
-- inside a note (note_id set). Own-row RLS only, so history stays private even in a shared space.
-- The app keeps at most 200 messages per thread and loads the last 50.
-- ============================================================

create table if not exists ai_chat_messages (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references profiles (id) on delete cascade,
  space_id   uuid        not null references spaces (id) on delete cascade,
  surface    text        not null check (surface in ('space', 'note')),
  note_id    uuid        null references notes (id) on delete cascade,
  role       text        not null check (role in ('user', 'assistant')),
  content    text        not null check (char_length(content) <= 8000),
  sources    jsonb       null,
  grounded   boolean     null,
  created_at timestamptz not null default now()
);

create index if not exists ai_chat_messages_thread
  on ai_chat_messages (user_id, space_id, surface, note_id, created_at);

alter table ai_chat_messages enable row level security;

drop policy if exists "ai_chat_messages select own" on ai_chat_messages;
create policy "ai_chat_messages select own" on ai_chat_messages for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "ai_chat_messages insert own" on ai_chat_messages;
create policy "ai_chat_messages insert own" on ai_chat_messages for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "ai_chat_messages delete own" on ai_chat_messages;
create policy "ai_chat_messages delete own" on ai_chat_messages for delete to authenticated
  using (user_id = auth.uid());
