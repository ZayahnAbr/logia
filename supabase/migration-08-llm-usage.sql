-- ============================================================
-- StudySpace migration 08 — per-user hourly LLM token budget
-- Run this in the Supabase SQL Editor.
-- ============================================================

create table llm_usage (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references profiles (id) on delete cascade,
  tokens     int         not null,
  created_at timestamptz not null default now()
);

create index on llm_usage (user_id, created_at);

alter table llm_usage enable row level security;

-- Each user can only see their own usage; writes happen via server actions (service-role-free,
-- so they go through the same policy as the authenticated user making the request).
create policy "usage self all" on llm_usage
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
