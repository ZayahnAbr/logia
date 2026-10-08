-- Migration 31: timetable from a photo. Safe to re-run. No dependencies.
-- One row per recurring weekly class, owned by the student, optionally linked to a space.
create table if not exists public.timetable_classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  space_id uuid null references public.spaces(id) on delete set null,
  title text not null,
  course_code text not null default '',
  class_type text not null default 'lecture',
  weekday smallint not null check (weekday between 0 and 6),
  start_min smallint not null check (start_min between 0 and 1439),
  end_min smallint not null check (end_min between 1 and 1440),
  venue text not null default '',
  term_start date null,
  term_end date null,
  created_at timestamptz not null default now()
);

create index if not exists timetable_classes_user_day_idx on public.timetable_classes (user_id, weekday, start_min);

alter table public.timetable_classes enable row level security;

drop policy if exists "timetable select own" on public.timetable_classes;
drop policy if exists "timetable insert own" on public.timetable_classes;
drop policy if exists "timetable update own" on public.timetable_classes;
drop policy if exists "timetable delete own" on public.timetable_classes;
create policy "timetable select own" on public.timetable_classes for select using (user_id = auth.uid());
create policy "timetable insert own" on public.timetable_classes for insert with check (user_id = auth.uid());
create policy "timetable update own" on public.timetable_classes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "timetable delete own" on public.timetable_classes for delete using (user_id = auth.uid());
