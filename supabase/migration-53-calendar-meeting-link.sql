-- ============================================================
-- StudySpace migration 53 — meeting links on calendar events
-- Run this in the Supabase SQL Editor. Lets an event carry a Teams, Zoom or Meet link.
-- ============================================================

alter table calendar_events add column if not exists meeting_url text not null default ''
  check (char_length(meeting_url) <= 600);
