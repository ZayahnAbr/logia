import type { SupabaseClient } from "@supabase/supabase-js";
import { COVER_COLORS } from "@/lib/notebookCovers";

// Finds a notebook by name in a space (case-insensitive) or creates it. "General" (or empty) means
// loose notes and returns null. Returns null if the notebooks table is not there yet (migration 26).
export async function notebookIdForName(supabase: SupabaseClient, spaceId: string, userId: string, rawName: string): Promise<string | null> {
  const name = rawName.trim().slice(0, 60);
  if (!name || name.toLowerCase() === "general") return null;
  const { data: found, error } = await supabase.from("notebooks").select("id, name").eq("space_id", spaceId).ilike("name", name.replace(/[%_\\]/g, "\\$&")).limit(1);
  if (error) return null;
  if (found && found[0]) return found[0].id as string;
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const color = COVER_COLORS[Math.abs(h) % COVER_COLORS.length].hex;
  const { data: top } = await supabase.from("notebooks").select("sort").eq("space_id", spaceId).order("sort", { ascending: false }).limit(1);
  const { data: made, error: e2 } = await supabase.from("notebooks")
    .insert({ space_id: spaceId, name, cover_kind: "color", cover_value: color, sort: ((top?.[0]?.sort as number | undefined) ?? 0) + 1, created_by: userId }).select("id").single();
  if (e2) {
    const { data: again } = await supabase.from("notebooks").select("id").eq("space_id", spaceId).ilike("name", name.replace(/[%_\\]/g, "\\$&")).limit(1);
    return (again?.[0]?.id as string | undefined) ?? null;
  }
  return made.id as string;
}
