-- ============================================================
-- StudySpace migration 17 — EPUB textbooks
-- Run this in the Supabase SQL Editor (after migrations 10 and 14).
-- ============================================================

-- Exact reading position inside an EPUB (an EPUB CFI). PDFs keep using last_page.
alter table library_books add column if not exists last_cfi text;

-- Let the library bucket store .epub files alongside PDFs and cover images.
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'application/epub+zip', 'image/jpeg', 'image/webp', 'image/png']
 where id = 'library';
