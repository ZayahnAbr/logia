-- ============================================================
-- StudySpace migration 11 — customisable dashboard
-- Stores which dashboard sections a user shows, and in what order:
-- [{ "id": "spaces", "visible": true }, ...]
-- ============================================================
alter table profiles add column if not exists dashboard_widgets jsonb;
