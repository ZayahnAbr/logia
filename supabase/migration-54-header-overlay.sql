-- ============================================================
-- Logia migration 54: choose the header's dark overlay and text colour
-- Run in the Supabase SQL Editor. Safe to re-run. Requires migration 38.
-- header_overlay: 0 to 80 (percent of black laid over a colour or picture). null = automatic.
-- header_tone: 'light' or 'dark' text. null = light.
-- ============================================================

alter table spaces add column if not exists header_overlay smallint;
alter table spaces add column if not exists header_tone text;
alter table spaces drop constraint if exists spaces_header_overlay_check;
alter table spaces add constraint spaces_header_overlay_check check (header_overlay is null or header_overlay between 0 and 80);
alter table spaces drop constraint if exists spaces_header_tone_check;
alter table spaces add constraint spaces_header_tone_check check (header_tone is null or header_tone in ('light', 'dark'));

create or replace function set_space_header_style(p_space uuid, p_overlay int, p_tone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not can_edit_space_header(p_space) then raise exception 'You cannot change this space header'; end if;
  if p_overlay is not null and (p_overlay < 0 or p_overlay > 80) then raise exception 'Invalid overlay'; end if;
  if p_tone is not null and p_tone not in ('light', 'dark') then raise exception 'Invalid text colour'; end if;
  update spaces set header_overlay = p_overlay, header_tone = p_tone where id = p_space;
end $$;
grant execute on function set_space_header_style(uuid, int, text) to authenticated;
