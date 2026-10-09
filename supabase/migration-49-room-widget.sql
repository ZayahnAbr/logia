-- Migration 49: a live room can be placed on a space home as a widget. Requires migrations 25 and 28. Safe to re-run.
alter table space_widgets drop constraint if exists space_widgets_kind_check;
alter table space_widgets add constraint space_widgets_kind_check check (kind in ('gif', 'image', 'text', 'sticky', 'room'));
