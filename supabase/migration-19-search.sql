-- ============================================================
-- StudySpace migration 19 — better Ask AI retrieval
-- Run this in the Supabase SQL Editor.
--
-- One call returns the best passages for a question:
--   * full-text search on title + content (any word may match, titles weigh more)
--   * trigram similarity as a fallback for typos and partial words
-- Runs as the caller (security invoker), so content_chunks RLS still applies.
-- ============================================================

create extension if not exists pg_trgm;

alter table content_chunks
  add column if not exists fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(source_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

create index if not exists content_chunks_fts on content_chunks using gin (fts);
create index if not exists content_chunks_trgm on content_chunks using gin (content gin_trgm_ops);
create index if not exists content_chunks_space on content_chunks (space_id, source_id, chunk_index);

create or replace function search_space(p_space_id uuid, p_query text, p_limit int default 8)
returns table (id uuid, source_type text, source_id uuid, source_title text, chunk_index int, content text, rank real)
language sql stable security invoker set search_path = public as $$
  with q as (
    -- OR the meaningful words together so a passage needn't contain every word.
    select nullif(string_agg(quote_literal(lexeme) || ':*', ' | '), '')::tsquery as tsq
    from unnest(to_tsvector('english', p_query)) as t(lexeme, positions, weights)
  ),
  fts as (
    select c.id, c.source_type, c.source_id, c.source_title, c.chunk_index, c.content,
           ts_rank_cd(c.fts, q.tsq, 32)::real as rank
    from content_chunks c, q
    where c.space_id = p_space_id and q.tsq is not null and c.fts @@ q.tsq
    order by rank desc
    limit p_limit
  ),
  fuzzy as (
    select c.id, c.source_type, c.source_id, c.source_title, c.chunk_index, c.content,
           (word_similarity(p_query, c.content) * 0.5)::real as rank
    from content_chunks c
    where c.space_id = p_space_id and not exists (select 1 from fts) and p_query <% c.content
    order by rank desc
    limit p_limit
  )
  select * from fts
  union all
  select * from fuzzy;
$$;

grant execute on function search_space(uuid, text, int) to authenticated;
