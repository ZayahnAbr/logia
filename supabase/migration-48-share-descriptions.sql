-- Migration 48: an owner-written description on each shared notebook or deck. Requires migration 39. Safe to re-run.
alter table space_shared_items add column if not exists description text not null default '';
alter table space_shared_items drop constraint if exists space_shared_items_description_len;
alter table space_shared_items add constraint space_shared_items_description_len check (char_length(description) <= 500);

-- Owners may edit their own rows (only the description changes in the app).
drop policy if exists "shared items own update" on space_shared_items;
create policy "shared items own update" on space_shared_items for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Same as migration 39, plus the description. The return type changes, so drop first.
drop function if exists shared_items_for_space(uuid);
create function shared_items_for_space(p_space uuid)
returns table (share_id uuid, kind text, item_id uuid, owner_id uuid, owner_name text, is_mine boolean,
               title text, cover_kind text, cover_value text, icon text, item_count integer, created_at timestamptz, description text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not shr_can_view(p_space) then return; end if;
  return query
    select s.id, s.kind, s.item_id, s.owner_id,
           coalesce(nullif(btrim(p.display_name), ''), 'A Logia student'),
           (s.owner_id = auth.uid()),
           n.name,
           case when n.cover_kind = 'image' then 'color' else n.cover_kind end,
           case when n.cover_kind = 'image' then '#E9806E' else n.cover_value end,
           n.icon,
           (select count(*)::int from notes t where t.notebook_id = n.id and t.created_by = s.owner_id),
           s.created_at, s.description
      from space_shared_items s
      join notebooks n on s.kind = 'notebook' and n.id = s.item_id and n.space_id = s.space_id and n.created_by = s.owner_id
      left join profiles p on p.id = s.owner_id
     where s.space_id = p_space
    union all
    select s.id, s.kind, s.item_id, s.owner_id,
           coalesce(nullif(btrim(p.display_name), ''), 'A Logia student'),
           (s.owner_id = auth.uid()),
           d.title, null::text, null::text, null::text,
           coalesce(jsonb_array_length(d.cards_json), 0),
           s.created_at, s.description
      from space_shared_items s
      join active_recall_decks d on s.kind = 'deck' and d.deck_id = s.item_id and d.space_id = s.space_id and d.created_by = s.owner_id
      left join profiles p on p.id = s.owner_id
     where s.space_id = p_space
    order by 12;
end $$;
grant execute on function shared_items_for_space(uuid) to authenticated;
