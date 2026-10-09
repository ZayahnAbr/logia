-- Migration 45: Google Docs two-way sync and Word / OneDrive connections (safe to re-run, requires the notes table).
--
-- oauth_tokens holds each person's encrypted refresh token for Google Docs (provider 'google') and OneDrive
-- (provider 'microsoft'). The token is encrypted on the server (AES-256-GCM, TOKEN_ENCRYPTION_KEY) before it
-- reaches the database. The table has RLS on and NO policies, so the browser cannot read or write it at all.
-- Server code reaches it only through the SECURITY DEFINER functions below, which act on auth.uid().
--
-- note_doc_links ties one note to one Google Doc: the last synced block snapshot (the base for the three-way merge),
-- the last Drive version that was merged, and a status. Owner-only RLS.

create table if not exists public.oauth_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  enc text not null,
  scope text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.oauth_tokens enable row level security;
revoke all on public.oauth_tokens from anon, authenticated;
-- Intentionally no policies: nothing can select, insert, update or delete through the API.

create or replace function public.set_oauth_token(p_provider text, p_enc text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_provider not in ('google', 'microsoft') then raise exception 'unknown provider'; end if;
  if p_enc is null or length(p_enc) < 20 or length(p_enc) > 8000 then raise exception 'bad token'; end if;
  insert into public.oauth_tokens (user_id, provider, enc, scope, updated_at)
  values (auth.uid(), p_provider, p_enc, left(coalesce(p_scope, ''), 500), now())
  on conflict (user_id, provider) do update set enc = excluded.enc, scope = excluded.scope, updated_at = now();
end $$;

-- Returns the ciphertext for the signed-in person only. It is useless without the server's key.
create or replace function public.get_oauth_token(p_provider text)
returns text language sql security definer stable set search_path = public as $$
  select enc from public.oauth_tokens where user_id = auth.uid() and provider = p_provider;
$$;

create or replace function public.oauth_token_status(p_provider text)
returns table (connected boolean, scope text, updated_at timestamptz)
language sql security definer stable set search_path = public as $$
  select true, t.scope, t.updated_at from public.oauth_tokens t where t.user_id = auth.uid() and t.provider = p_provider;
$$;

create or replace function public.delete_oauth_token(p_provider text)
returns void language sql security definer set search_path = public as $$
  delete from public.oauth_tokens where user_id = auth.uid() and provider = p_provider;
$$;

revoke all on function public.set_oauth_token(text, text, text) from public, anon;
revoke all on function public.get_oauth_token(text) from public, anon;
revoke all on function public.oauth_token_status(text) from public, anon;
revoke all on function public.delete_oauth_token(text) from public, anon;
grant execute on function public.set_oauth_token(text, text, text) to authenticated;
grant execute on function public.get_oauth_token(text) to authenticated;
grant execute on function public.oauth_token_status(text) to authenticated;
grant execute on function public.delete_oauth_token(text) to authenticated;

create table if not exists public.note_doc_links (
  note_id uuid primary key references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  doc_id text not null,
  doc_title text,
  last_synced_revision text,
  snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'synced' check (status in ('synced', 'conflict', 'error')),
  updated_at timestamptz not null default now()
);
create index if not exists note_doc_links_user_idx on public.note_doc_links (user_id);

alter table public.note_doc_links enable row level security;
drop policy if exists "note_doc_links owner select" on public.note_doc_links;
drop policy if exists "note_doc_links owner insert" on public.note_doc_links;
drop policy if exists "note_doc_links owner update" on public.note_doc_links;
drop policy if exists "note_doc_links owner delete" on public.note_doc_links;
create policy "note_doc_links owner select" on public.note_doc_links for select using (user_id = auth.uid());
create policy "note_doc_links owner insert" on public.note_doc_links for insert
  with check (user_id = auth.uid() and exists (select 1 from public.notes n where n.id = note_id));
create policy "note_doc_links owner update" on public.note_doc_links for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "note_doc_links owner delete" on public.note_doc_links for delete using (user_id = auth.uid());

insert into public.migrations_applied (name) values ('migration-45-doc-sync')
  on conflict do nothing;
