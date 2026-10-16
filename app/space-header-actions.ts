"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { HEADER_BUCKET, HEX_RE, cleanOverlay, cleanTone, type HeaderKind, type HeaderStyle } from "@/lib/spaceHeader";

const MISSING = "Custom headers need a database update. Run supabase/migration-38-space-header.sql.";

// Saves the header through set_space_header (which checks who may change it), then deletes the file it replaced.
export async function saveSpaceHeader(spaceId: string, kind: HeaderKind, color: string | null, path: string | null, style?: HeaderStyle): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  if (kind === "color" && !(color && HEX_RE.test(color))) return { error: "Pick a valid colour." };
  if (kind === "image" && !(path && path.startsWith(`${spaceId}/`))) return { error: "That image isn't valid." };

  const { data: before } = await supabase.from("spaces").select("header_image_path").eq("id", spaceId).maybeSingle();
  const oldPath = (before as { header_image_path?: string | null } | null)?.header_image_path ?? null;

  const { error } = await supabase.rpc("set_space_header", { p_space: spaceId, p_kind: kind, p_color: kind === "color" ? color : null, p_path: kind === "image" ? path : null });
  if (error) {
    if (kind === "image" && path) await supabase.storage.from(HEADER_BUCKET).remove([path]);
    if (/schema cache|does not exist|could not find the function/i.test(error.message)) return { error: MISSING };
    if (/cannot change/i.test(error.message)) return { error: "You can't change this header." };
    return { error: "Couldn't save the header. Try again." };
  }
  const keep = kind === "image" ? path : null;
  if (oldPath && oldPath !== keep) await supabase.storage.from(HEADER_BUCKET).remove([oldPath]);
  // The default header has no overlay or text choice; colour and image keep what the student picked.
  const st = kind === "default" ? { overlay: null, tone: null } : { overlay: cleanOverlay(style?.overlay), tone: cleanTone(style?.tone) };
  const styled = await writeStyle(supabase, spaceId, st);
  revalidatePath(`/spaces/${spaceId}`);
  return styled;
}

async function writeStyle(supabase: Awaited<ReturnType<typeof createClient>>, spaceId: string, st: HeaderStyle): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("set_space_header_style", { p_space: spaceId, p_overlay: st.overlay, p_tone: st.tone });
  if (!error) return {};
  if (/schema cache|does not exist|could not find the function/i.test(error.message)) {
    // Migration 54 not run: only a problem when the student actually chose something.
    return st.overlay === null && st.tone === null ? {} : { error: "Overlay and text colour need a database update. Run supabase/migration-54-header-overlay.sql." };
  }
  return { error: "Couldn't save the overlay. Try again." };
}

/** Changes only the overlay and text colour of the current header (no new picture needed). */
export async function saveSpaceHeaderStyle(spaceId: string, style: HeaderStyle): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const res = await writeStyle(supabase, spaceId, { overlay: cleanOverlay(style.overlay), tone: cleanTone(style.tone) });
  if (!res.error) revalidatePath(`/spaces/${spaceId}`);
  return res;
}
