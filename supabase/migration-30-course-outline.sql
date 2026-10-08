-- ============================================================
-- Logia migration 30: Set up a space from a course outline
-- Requires migration 25 (is_space_member) and 26 (notebooks). Run in the Supabase SQL Editor. Safe to re-run.
-- Everything here is per person (like sticky notes): own rows only, and only inside spaces you belong to.
-- ============================================================

create table if not exists course_outlines (
  id          uuid        primary key default gen_random_uuid(),
  space_id    uuid        not null references spaces (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references profiles (id) on delete cascade,
  course_code text,
  course_name text,
  lecturer    text,
  textbooks   jsonb       not null default '[]'::jsonb,
  raw         jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists course_outlines_user_space on course_outlines (user_id, space_id, created_at desc);

create table if not exists course_assessments (
  id             uuid        primary key default gen_random_uuid(),
  space_id       uuid        not null references spaces (id) on delete cascade,
  user_id        uuid        not null default auth.uid() references profiles (id) on delete cascade,
  title          text        not null check (char_length(btrim(title)) between 1 and 160),
  type           text        not null default 'other' check (type in ('test', 'exam', 'assignment', 'quiz', 'other')),
  weight_percent numeric     check (weight_percent is null or (weight_percent >= 0 and weight_percent <= 100)),
  due_at         timestamptz,
  mark_percent   numeric     check (mark_percent is null or (mark_percent >= 0 and mark_percent <= 100)),
  created_at     timestamptz not null default now()
);
create index if not exists course_assessments_user_space on course_assessments (user_id, space_id, created_at);

-- Topic checklist: the topics found in the outline, with a done tick (a notebook may or may not exist for each).
create table if not exists course_topics (
  id          uuid        primary key default gen_random_uuid(),
  space_id    uuid        not null references spaces (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references profiles (id) on delete cascade,
  name        text        not null check (char_length(btrim(name)) between 1 and 160),
  week        text        check (week is null or char_length(week) <= 40),
  done        boolean     not null default false,
  sort        integer     not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists course_topics_user_space on course_topics (user_id, space_id, sort);

alter table course_outlines    enable row level security;
alter table course_assessments enable row level security;
alter table course_topics      enable row level security;

drop policy if exists "course_outlines own" on course_outlines;
create policy "course_outlines own" on course_outlines for all to authenticated
  using (user_id = auth.uid() and is_space_member(space_id))
  with check (user_id = auth.uid() and is_space_member(space_id));

drop policy if exists "course_assessments own" on course_assessments;
create policy "course_assessments own" on course_assessments for all to authenticated
  using (user_id = auth.uid() and is_space_member(space_id))
  with check (user_id = auth.uid() and is_space_member(space_id));

drop policy if exists "course_topics own" on course_topics;
create policy "course_topics own" on course_topics for all to authenticated
  using (user_id = auth.uid() and is_space_member(space_id))
  with check (user_id = auth.uid() and is_space_member(space_id));
