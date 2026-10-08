-- ============================================================
-- StudySpace migration 18 — @mentions in study-room chat
-- Run this in the Supabase SQL Editor (after migration 12).
-- ============================================================

-- Who a message mentions, so they can be highlighted and poked.
alter table room_messages add column if not exists mentions uuid[] not null default '{}';
alter table room_messages drop constraint if exists room_messages_mentions_max;
alter table room_messages add constraint room_messages_mentions_max check (coalesce(array_length(mentions, 1), 0) <= 10);
