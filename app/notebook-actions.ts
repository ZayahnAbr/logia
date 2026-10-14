"use server";
import { revalidatePath } from "next/cache";
import { authed } from "@/lib/server/llm";
import { COVER_BUCKET, DEFAULT_COVER_COLOR, validateCover, parseCover, type Cover } from "@/lib/notebookCovers";
// cover_value for an image cover may carry a "#x,y" drag-to-reposition suffix; compare and delete by the
// underlying storage path, not the raw value, or repositioning a cover would delete its own file.
const coverPath = (value: string | null) => (value ? parseCover({ kind: "image", value })?.path ?? value : value);

const MISSING = "Notebooks aren't set up yet. Run migration 26 in Supabase first.";
const fail = (m: string) => (/notebooks|notebook_id|schema cache/i.test(m) ? MISSING : m);
const refresh = (spaceId: string) => revalidatePath(`/spaces/${spaceId}/notes`);
const cleanName = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 60);
const cleanIcon = (s: string | null | undefined) => { const t = (s ?? "").trim(); return t && t.length <= 16 && !/[<>]/.test(t) ? t : null; };

export async function createNotebook(spaceId: string, name: string, cover: Cover | null, icon: string | null) {
  const { supabase, user } = await authed();
  const n = cleanName(name);
  if (!n) return { error: "Give the notebook a name." };
  const c = cover ? validateCover(cover, user.id, spaceId) : { cover: { kind: "color" as const, value: DEFAULT_COVER_COLOR } };
  if ("error" in c) return { error: c.error };
  const { data: top } = await supabase.from("notebooks").select("sort").eq("space_id", spaceId).order("sort", { ascending: false }).limit(1);
  const { data, error } = await supabase.from("notebooks")
    .insert({ space_id: spaceId, name: n, cover_kind: c.cover.kind, cover_value: c.cover.value, icon: cleanIcon(icon), sort: ((top?.[0]?.sort as number | undefined) ?? 0) + 1, created_by: user.id })
    .select("id").single();
  if (error) return { error: error.code === "23505" ? "You already have a notebook with that name." : fail(error.message) };
  refresh(spaceId);
  return { id: data.id as string };
}

export async function updateNotebook(spaceId: string, id: string, name: string, cover: Cover, icon: string | null) {
  const { supabase, user } = await authed();
  const n = cleanName(name);
  if (!n) return { error: "Give the notebook a name." };
  const c = validateCover(cover, user.id, spaceId);
  if ("error" in c) return { error: c.error };
  const { data: old } = await supabase.from("notebooks").select("cover_kind, cover_value").eq("id", id).eq("space_id", spaceId).maybeSingle();
  const { error } = await supabase.from("notebooks")
    .update({ name: n, cover_kind: c.cover.kind, cover_value: c.cover.value, icon: cleanIcon(icon), updated_at: new Date().toISOString() })
    .eq("id", id).eq("space_id", spaceId);
  if (error) return { error: error.code === "23505" ? "You already have a notebook with that name." : fail(error.message) };
  // Keep the legacy folder label in step with the name.
  await supabase.from("notes").update({ folder: n }).eq("notebook_id", id);
  if (old?.cover_kind === "image" && coverPath(old.cover_value) !== coverPath(c.cover.value)) await supabase.storage.from(COVER_BUCKET).remove([coverPath(old.cover_value) as string]);
  refresh(spaceId);
  return {};
}

export async function deleteNotebook(spaceId: string, id: string) {
  const { supabase } = await authed();
  const { data: old } = await supabase.from("notebooks").select("cover_kind, cover_value").eq("id", id).eq("space_id", spaceId).maybeSingle();
  // Notes are kept: they move to Loose notes (the foreign key also sets notebook_id to null).
  await supabase.from("notes").update({ notebook_id: null, folder: "General" }).eq("notebook_id", id);
  const { error } = await supabase.from("notebooks").delete().eq("id", id).eq("space_id", spaceId);
  if (error) return { error: fail(error.message) };
  if (old?.cover_kind === "image") await supabase.storage.from(COVER_BUCKET).remove([coverPath(old.cover_value) as string]);
  refresh(spaceId);
  return {};
}

export async function reorderNotebooks(spaceId: string, orderedIds: string[]) {
  const { supabase } = await authed();
  const results = await Promise.all(orderedIds.slice(0, 500).map((id, i) =>
    supabase.from("notebooks").update({ sort: i + 1 }).eq("id", id).eq("space_id", spaceId)));
  const bad = results.find((r) => r.error);
  if (bad?.error) return { error: fail(bad.error.message) };
  refresh(spaceId);
  return {};
}

// notebookId null = Loose notes.
export async function moveNoteToNotebook(spaceId: string, noteId: string, notebookId: string | null) {
  const { supabase } = await authed();
  let folder = "General";
  if (notebookId) {
    const { data: nb } = await supabase.from("notebooks").select("name").eq("id", notebookId).eq("space_id", spaceId).maybeSingle();
    if (!nb) return { error: "That notebook no longer exists." };
    folder = nb.name as string;
  }
  const { error } = await supabase.from("notes").update({ notebook_id: notebookId, folder }).eq("id", noteId).eq("space_id", spaceId);
  if (error) return { error: fail(error.message) };
  refresh(spaceId);
  return {};
}

// cover null removes the note's cover.
export async function setNoteCover(spaceId: string, noteId: string, cover: Cover | null) {
  const { supabase, user } = await authed();
  let patch: { cover_kind: string | null; cover_value: string | null } = { cover_kind: null, cover_value: null };
  if (cover) {
    const c = validateCover(cover, user.id, spaceId);
    if ("error" in c) return { error: c.error };
    patch = { cover_kind: c.cover.kind, cover_value: c.cover.value };
  }
  const { data: old } = await supabase.from("notes").select("cover_kind, cover_value").eq("id", noteId).eq("space_id", spaceId).maybeSingle();
  const { error } = await supabase.from("notes").update(patch).eq("id", noteId).eq("space_id", spaceId);
  if (error) return { error: fail(error.message) };
  if (old?.cover_kind === "image" && coverPath(old.cover_value) !== coverPath(patch.cover_value)) await supabase.storage.from(COVER_BUCKET).remove([coverPath(old.cover_value) as string]);
  refresh(spaceId);
  return {};
}
