-- ============================================================
-- StudySpace migration 05 — swap the ladder scheduler for FSRS
-- Run this in the Supabase SQL Editor.
-- ============================================================

alter table card_reviews
  drop column if exists ladder_idx,
  drop column if exists last_rated,
  add column if not exists stability      double precision not null default 0,
  add column if not exists difficulty     double precision not null default 0,
  add column if not exists scheduled_days double precision not null default 0,
  add column if not exists state          int not null default 0,
  add column if not exists last_review    timestamptz;
