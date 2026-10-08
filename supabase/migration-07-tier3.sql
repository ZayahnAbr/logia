-- ============================================================
-- StudySpace migration 07 — Tier 3: formula sheet builder
-- Run this in the Supabase SQL Editor.
-- ============================================================

create table formulas (
  id         uuid        primary key default gen_random_uuid(),
  space_id   uuid        not null references spaces (id) on delete cascade,
  label      text        not null,
  latex      text        not null,
  topic      text,
  created_by uuid        not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index on formulas (space_id, topic);

alter table formulas enable row level security;

create policy "formulas read" on formulas for select using (auth.uid() is not null);
create policy "formulas write" on formulas for insert with check (created_by = auth.uid());
create policy "formulas delete own" on formulas for delete using (created_by = auth.uid());
