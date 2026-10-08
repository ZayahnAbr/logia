-- ============================================================
-- Logia migration 28: sticky notes become free stickers on the space home
-- Requires migration 25 (space_widgets) and migration 16 (sticky_notes).
-- Run in the Supabase SQL Editor. Safe to re-run.
-- Notes stay private to each person, as before. Existing sticky_notes rows are COPIED into
-- space_widgets (kind 'sticky'); the old table is left untouched as a backup.
-- The app hides the old Sticky notes widget only once the marker row at the end exists.
-- ============================================================

alter table space_widgets drop constraint if exists space_widgets_kind_check;
alter table space_widgets add constraint space_widgets_kind_check check (kind in ('gif', 'image', 'text', 'sticky'));

-- Small marker table so the app can tell whether this migration has been run.
create table if not exists migrations_applied (
  name       text        primary key,
  applied_at timestamptz not null default now()
);
alter table migrations_applied enable row level security;
drop policy if exists "migrations_applied read" on migrations_applied;
create policy "migrations_applied read" on migrations_applied for select to authenticated using (true);

-- Copy each old note once (matched by data->>'legacyId'). Positions: a loose grid from the top left,
-- x as a fraction of the page width, y in pixels, w in pixels. Text is capped to fit the widget size limit.
insert into space_widgets (user_id, space_id, kind, data, created_at)
select n.user_id, n.space_id, 'sticky',
       jsonb_build_object(
         'text', left(n.body, 1500),
         'color', case when n.color in ('yellow', 'pink', 'blue', 'green', 'peach') then n.color else 'yellow' end,
         'legacyId', n.id::text,
         'x', round((0.04 + ((n.rn - 1) % 4) * 0.2)::numeric, 3),
         'y', 16 + (((n.rn - 1) / 4) * 230),
         'w', 200
       ),
       n.created_at
  from (
    select s.*, row_number() over (partition by s.user_id, s.space_id order by s.created_at, s.id) as rn
      from sticky_notes s
  ) n
 where not exists (
   select 1 from space_widgets w
    where w.user_id = n.user_id and w.space_id = n.space_id and w.kind = 'sticky' and w.data ->> 'legacyId' = n.id::text
 );

insert into migrations_applied (name) values ('migration-28-sticky-stickers') on conflict (name) do nothing;
