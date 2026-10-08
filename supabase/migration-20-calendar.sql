-- ============================================================
-- StudySpace migration 20 — calendar: tests, assignments and tasks
-- Run this in the Supabase SQL Editor. Private to each user.
-- ============================================================

create table if not exists calendar_events (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references profiles (id) on delete cascade,
  space_id   uuid        references spaces (id) on delete cascade,      -- null = not tied to a space
  title      text        not null check (char_length(title) between 1 and 160),
  kind       text        not null default 'task' check (kind in ('test', 'assignment', 'task', 'other')),
  due_at     timestamptz not null,
  all_day    boolean     not null default false,
  urgency    text        not null default 'medium' check (urgency in ('low', 'medium', 'high', 'urgent')),
  color      text        not null default '#f2836b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  notes      text        not null default '' check (char_length(notes) <= 1000),
  done       boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_user_due on calendar_events (user_id, due_at);
create index if not exists calendar_events_space on calendar_events (space_id, due_at);

alter table calendar_events enable row level security;
drop policy if exists "calendar self" on calendar_events;
create policy "calendar self" on calendar_events for all using (user_id = auth.uid()) with check (user_id = auth.uid());
