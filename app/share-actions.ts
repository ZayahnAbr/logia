"use server";

import { createClient } from "@/lib/supabase/server";

// Expiring download links for sharing outside Logia (anyone with the link can open it until it expires).
const WEEK = 60 * 60 * 24 * 7;

export async function shareFileLink(spaceId: string, fileId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to continue." };
  const { data: f } = await supabase.from("files").select("name, path").eq("id", fileId).eq("space_id", spaceId).maybeSingle();
  if (!f) return { error: "That file no longer exists." };
  const { data, error } = await supabase.storage.from("space-files").createSignedUrl(f.path, WEEK);
  if (error || !data) return { error: "Couldn't create a share link. Try again." };
  return { title: f.name as string, url: data.signedUrl };
}

export async function shareBookLink(bookId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to continue." };
  const { data: b } = await supabase.from("library_books").select("title, file_path").eq("id", bookId).maybeSingle();
  if (!b) return { error: "That textbook no longer exists." };
  const { data, error } = await supabase.storage.from("library").createSignedUrl(b.file_path, WEEK);
  if (error || !data) return { error: "Couldn't create a share link. Try again." };
  return { title: b.title as string, url: data.signedUrl };
}
