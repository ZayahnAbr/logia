"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  return { supabase, user };
}

function dbError(message: string, action: string) {
  if (/relation .* does not exist|schema cache/i.test(message))
    return `Couldn't ${action}: the library isn't set up in the database yet. Ask the site admin to run migration 10.`;
  return `Couldn't ${action}. Please try again.`;
}

// Called after the browser has uploaded the PDF straight to storage.
export async function createLibraryBook(title: string, filePath: string, sizeBytes: number, pageCount: number | null) {
  const { supabase, user } = await authed();
  if (!filePath.startsWith(`${user.id}/`)) return { error: "That upload doesn't belong to your account." };
  const { data, error } = await supabase.from("library_books")
    .insert({ user_id: user.id, title: title.slice(0, 200) || "Untitled book", file_path: filePath, size_bytes: sizeBytes, page_count: pageCount })
    .select("id").single();
  if (error) {
    await supabase.storage.from("library").remove([filePath]); // don't leave an orphaned file behind
    return { error: dbError(error.message, "save this textbook") };
  }
  revalidatePath("/library");
  return { id: data.id as string };
}

export async function setBookCover(bookId: string, coverPath: string, pageCount: number | null) {
  const { supabase, user } = await authed();
  if (!coverPath.startsWith(`${user.id}/covers/`)) return { error: "That cover doesn't belong to your account." };
  const patch: Record<string, unknown> = { cover_path: coverPath };
  if (pageCount) patch.page_count = pageCount;
  const { error } = await supabase.from("library_books").update(patch).eq("id", bookId);
  if (error) return { error: /cover_path/.test(error.message) ? "Book covers need a database update. Run supabase/migration-14-book-covers.sql." : error.message };
  return {};
}

export async function deleteLibraryBook(bookId: string) {
  const { supabase } = await authed();
  const { data: book } = await supabase.from("library_books").select("*").eq("id", bookId).single();
  if (!book) return { error: "That textbook no longer exists." };
  await supabase.storage.from("library").remove([book.file_path, ...(book.cover_path ? [book.cover_path] : [])]);
  const { error } = await supabase.from("library_books").delete().eq("id", bookId);
  if (error) return { error: dbError(error.message, "delete this textbook") };
  revalidatePath("/library");
  return {};
}

export async function getBookFileUrl(bookId: string) {
  const { supabase } = await authed();
  const { data: book } = await supabase.from("library_books").select("file_path").eq("id", bookId).single();
  if (!book) return { error: "That textbook no longer exists." };
  const { data, error } = await supabase.storage.from("library").createSignedUrl(book.file_path, 60 * 60 * 6);
  if (error || !data) return { error: "Couldn't open this PDF. It may have been removed, so try uploading it again." };
  return { url: data.signedUrl };
}

export async function saveEpubPosition(bookId: string, cfi: string, pct: number) {
  const { supabase } = await authed();
  const base = { last_page: Math.max(1, Math.min(100, Math.round(pct))), page_count: 100, opened_at: new Date().toISOString() };
  const { error } = await supabase.from("library_books").update({ ...base, last_cfi: cfi.slice(0, 500) }).eq("id", bookId);
  if (error) await supabase.from("library_books").update(base).eq("id", bookId); // migration 17 not run: keep % progress
  return {};
}

export async function saveReadingPosition(bookId: string, page: number, pageCount?: number) {
  const { supabase } = await authed();
  const patch: Record<string, unknown> = { last_page: page, opened_at: new Date().toISOString() };
  if (pageCount) patch.page_count = pageCount;
  await supabase.from("library_books").update(patch).eq("id", bookId);
  return {};
}

export type HighlightRect = { x: number; y: number; w: number; h: number };

// Always-fresh annotations — the reader calls this on open so a cached page payload
// (e.g. returning via the back button) can never show a stale set of highlights.
export async function getBookAnnotations(bookId: string) {
  const { supabase } = await authed();
  const [{ data: highlights, error: hErr }, { data: bookmarks, error: bErr }] = await Promise.all([
    supabase.from("library_highlights").select("id, page, text, color, rects, note, created_at").eq("book_id", bookId).order("page").order("created_at"),
    supabase.from("library_bookmarks").select("id, page, label, created_at").eq("book_id", bookId).order("page"),
  ]);
  if (hErr || bErr) return { error: dbError((hErr ?? bErr)!.message, "load your highlights") };
  return { highlights: highlights ?? [], bookmarks: bookmarks ?? [] };
}

// Rename any library upload (display title only — the stored file is untouched).
export async function renameLibraryBook(bookId: string, title: string) {
  const { supabase } = await authed();
  const clean = title.trim().slice(0, 200);
  if (!clean) return { error: "The name can't be empty." };
  const { error } = await supabase.from("library_books").update({ title: clean }).eq("id", bookId);
  if (error) return { error: dbError(error.message, "rename this textbook") };
  revalidatePath("/library");
  revalidatePath(`/library/${bookId}`);
  return {};
}

export async function addHighlight(bookId: string, page: number, text: string, color: string, rects: HighlightRect[]) {
  const { supabase, user } = await authed();
  const { data, error } = await supabase.from("library_highlights")
    .insert({ book_id: bookId, user_id: user.id, page, text: text.slice(0, 4000), color, rects })
    .select("id, page, text, color, rects, note, created_at").single();
  if (error) return { error: dbError(error.message, "save the highlight") };
  return { highlight: data };
}

export async function updateHighlight(id: string, patch: { note?: string; color?: string }) {
  const { supabase } = await authed();
  const { error } = await supabase.from("library_highlights").update({
    ...(patch.note !== undefined ? { note: patch.note.slice(0, 2000) } : {}),
    ...(patch.color ? { color: patch.color } : {}),
  }).eq("id", id);
  if (error) return { error: dbError(error.message, "update the highlight") };
  return {};
}

export async function deleteHighlight(id: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("library_highlights").delete().eq("id", id);
  if (error) return { error: dbError(error.message, "remove the highlight") };
  return {};
}

export async function toggleBookmark(bookId: string, page: number, label = "") {
  const { supabase, user } = await authed();
  const { data: existing } = await supabase.from("library_bookmarks").select("id").eq("book_id", bookId).eq("page", page).maybeSingle();
  if (existing) {
    await supabase.from("library_bookmarks").delete().eq("id", existing.id);
    return { bookmarked: false as const };
  }
  const { data, error } = await supabase.from("library_bookmarks")
    .insert({ book_id: bookId, user_id: user.id, page, label: label.slice(0, 120) })
    .select("id, page, label, created_at").single();
  if (error) return { error: dbError(error.message, "save the bookmark") };
  return { bookmarked: true as const, bookmark: data };
}
