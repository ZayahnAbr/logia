-- ============================================================
-- StudySpace migration 12 — Study rooms (live co-study)
-- Run this in the Supabase SQL Editor.
-- Who is in a room right now is Realtime *presence* (not stored).
-- The room, its shared timer and chat are stored here.
-- ============================================================

create table study_rooms (
  id               uuid        primary key default gen_random_uuid(),
  space_id         uuid        not null references spaces (id) on delete cascade,
  title            text        not null,
  goal             text,
  silent           boolean     not null default true,
  chat_enabled     boolean     not null default true,
  timer_minutes    int         not null default 50 check (timer_minutes between 5 and 180),
  timer_started_at timestamptz,          -- null = timer not running
  created_by       uuid        not null references profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  ended_at         timestamptz
);
create index on study_rooms (space_id, created_at desc);

create table room_messages (
  id         uuid        primary key default gen_random_uuid(),
  room_id    uuid        not null references study_rooms (id) on delete cascade,
  user_id    uuid        not null references profiles (id) on delete cascade,
  author     text        not null,
  body       text        not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index on room_messages (room_id, created_at);

alter table study_rooms   enable row level security;
alter table room_messages enable row level security;

-- `spaces` is already RLS-limited to members, so "the space is visible" = "I'm a member".
create policy "rooms read"   on study_rooms for select using (exists (select 1 from spaces s where s.id = space_id));
create policy "rooms create" on study_rooms for insert with check (created_by = auth.uid() and exists (select 1 from spaces s where s.id = space_id));
-- Any member can start/reset the shared timer; only the creator can end the room (enforced in the app action too).
create policy "rooms update" on study_rooms for update using (exists (select 1 from spaces s where s.id = space_id));
create policy "rooms delete" on study_rooms for delete using (created_by = auth.uid());

create policy "messages read" on room_messages for select
  using (exists (select 1 from study_rooms r where r.id = room_id));
create policy "messages send" on room_messages for insert
  with check (user_id = auth.uid() and exists (select 1 from study_rooms r where r.id = room_id and r.chat_enabled and r.ended_at is null));

-- Push row changes to connected clients (timer + chat).
alter publication supabase_realtime add table study_rooms;
alter publication supabase_realtime add table room_messages;
