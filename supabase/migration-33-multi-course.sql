-- ============================================================
-- Logia migration 33: several courses per space
-- Requires migration 30. Run in the Supabase SQL Editor. Safe to re-run.
-- course_outlines rows become the course records; assessments and topics attach to one.
-- RLS from migration 30 is unchanged (own rows, space members only).
-- ============================================================

alter table course_outlines add column if not exists sort     integer not null default 0;
alter table course_outlines add column if not exists archived boolean not null default false;

alter table course_assessments add column if not exists course_id uuid references course_outlines (id) on delete cascade;
alter table course_topics      add column if not exists course_id uuid references course_outlines (id) on delete cascade;
create index if not exists course_assessments_user_course on course_assessments (user_id, course_id);
create index if not exists course_topics_user_course      on course_topics (user_id, course_id);

-- Old rows (one course per space) attach to that person's most recent outline in the space.
update course_assessments a set course_id = (
  select o.id from course_outlines o
   where o.user_id = a.user_id and o.space_id = a.space_id
   order by o.created_at desc limit 1)
 where a.course_id is null;

update course_topics t set course_id = (
  select o.id from course_outlines o
   where o.user_id = t.user_id and o.space_id = t.space_id
   order by o.created_at desc limit 1)
 where t.course_id is null;

-- Older outline rows that were replaced before this migration are not real courses any more.
-- Keep only the newest per person and space that still owns rows; others stay but are archived.
update course_outlines o set archived = true
 where not exists (select 1 from course_assessments a where a.course_id = o.id)
   and not exists (select 1 from course_topics t where t.course_id = o.id)
   and exists (select 1 from course_outlines n
                where n.user_id = o.user_id and n.space_id = o.space_id and n.created_at > o.created_at);
