-- ============================================================
-- StudySpace migration 14 — library book covers
-- Run this in the Supabase SQL Editor (after migration 10).
-- Covers are page 1 of the PDF, rendered in the browser and stored as a small JPEG
-- at <user_id>/covers/<book_id>.jpg in the private 'library' bucket.
-- ============================================================

alter table library_books add column if not exists cover_path text;

-- Let the bucket hold cover images as well as PDFs.
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/webp', 'image/png']
 where id = 'library';

-- Allow re-rendering a cover (upsert) — still only inside the user's own folder.
drop policy if exists "library update own" on storage.objects;
create policy "library update own" on storage.objects for update
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
