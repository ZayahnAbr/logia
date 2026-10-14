-- Migration 50: Discover's public-spaces list also returns the space's header colour/kind and its owner,
-- so the card can show a real preview (instead of a flat placeholder) and grey out "Join" on your own space.
-- Requires migration 41. Safe to re-run. No storage access added: header images still fall back to the
-- placeholder band (reading them would need an extra signed-URL function; colour headers work as-is).
drop function if exists discover_spaces(text, text[], text, text, text);
create function discover_spaces(p_q text default null, p_tags text[] default null, p_level text default null,
                                 p_institution text default null, p_sort text default 'members')
returns table (id uuid, name text, subject text, public_description text, member_count bigint, created_at timestamptz,
               tags text[], institution text, level text, copy_count bigint,
               header_kind text, header_color text, created_by uuid)
language plpgsql stable security definer set search_path = public as $$
declare mt text; q text := nullif(btrim(coalesce(p_q, '')), ''); sql text;
begin
  if auth.uid() is null then return; end if;
  select c.table_name into mt
    from information_schema.columns c
    join information_schema.columns u on u.table_schema = c.table_schema and u.table_name = c.table_name and u.column_name = 'user_id'
   where c.table_schema = 'public' and c.column_name = 'space_id' and c.table_name ilike '%member%'
   order by (c.table_name = 'space_members') desc limit 1;
  sql := format($f$
    select s.id, s.name, s.subject, s.public_description, %s, s.created_at, s.tags, s.institution, s.level,
           %s, s.header_kind, s.header_color, s.created_by
      from spaces s
     where s.is_public and not coalesce(s.hidden, false)
       and ($1 is null or s.name ilike '%%' || $1 || '%%' or s.public_description ilike '%%' || $1 || '%%' or s.subject ilike '%%' || $1 || '%%'
            or exists (select 1 from unnest(s.tags) t where t ilike '%%' || $1 || '%%'))
       and ($2 is null or cardinality($2) = 0 or s.tags @> $2)
       and ($3 is null or s.level = $3)
       and ($4 is null or lower(s.institution) = lower($4))
     order by %s limit 200$f$,
    case when mt is null then '1::bigint' else format('(select count(*) from %I m where m.space_id = s.id)::bigint', mt) end,
    case when to_regclass('public.space_clone_log') is null then '0::bigint'
         else '(select count(*) from space_clone_log l where l.source = s.id)::bigint' end,
    case p_sort when 'newest' then 's.created_at desc'
                when 'copied' then '10 desc, s.created_at desc'
                else '5 desc, s.created_at desc' end);
  return query execute sql using q, p_tags, nullif(p_level, ''), nullif(btrim(coalesce(p_institution, '')), '');
end $$;
grant execute on function discover_spaces(text, text[], text, text, text) to authenticated;
