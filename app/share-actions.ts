"use server";

import { createClient } from "@/lib/supabase/server";

// Expiring download links for sharing outside Logia (anyone with the link can open it until it expires).
// Kept short so a link pasted somewhere public stops working quickly. Library textbooks are never
// shareable this way: they are almost always copyrighted.
const LINK_TTL = 60 * 60;

export async function shareFileLink(spaceId: string, fileId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to continue." };
  const { data: f } = await supabase.from("files").select("name, path").eq("id", fileId).eq("space_id", spaceId).maybeSingle();
  if (!f) return { error: "That file no longer exists." };
  const { data, error } = await supabase.storage.from("space-files").createSignedUrl(f.path, LINK_TTL);
  if (error || !data) return { error: "Couldn't create a share link. Try again." };
  return { title: f.name as string, url: data.signedUrl };
}
