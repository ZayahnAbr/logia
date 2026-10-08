-- ============================================================
-- StudySpace migration 04 — onboarding tour flag
-- Run this in the Supabase SQL Editor.
-- ============================================================

alter table profiles
  add column if not exists onboarding_completed boolean not null default false;
