-- Migration 32: timetable maker styling and notes. Safe to re-run. Requires migration 31.
-- color is a hex like #e8835a chosen from the palette in lib/timetable.ts (null = default for the class type).
alter table public.timetable_classes add column if not exists color text null;
alter table public.timetable_classes add column if not exists notes text not null default '';
