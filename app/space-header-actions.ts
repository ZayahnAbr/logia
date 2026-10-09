"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { HEADER_BUCKET, HEX_RE, type HeaderKind } from "@/lib/spaceHeader";

const MISSING = "Custom headers need a database update. Run supabase/migration-38-space-header.sql.";

// Saves the header through set_space_header (which checks who may change it), then deletes the file it replaced.
export async function saveSpaceHeader(spaceId: string, kind: HeaderKind, color: string | null, path: string | null): Promise<{ error?: string }> {
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
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}
