"use server";
import { revalidatePath } from "next/cache";
import { authed } from "@/lib/server/llm";
import { noteText } from "@/lib/server/rag";
import { WIDGET_BUCKET, MAX_IMAGE_BYTES } from "@/lib/customWidgets";
import { HEADER_BUCKET } from "@/lib/spaceHeader";

// Shared notebooks and flashcards, and copying a public space (migration 39).
export type SharedItem = {
  share_id: string; kind: "notebook" | "deck"; item_id: string; owner_id: string; owner_name: string; is_mine: boolean;
  title: string; cover_kind: string | null; cover_value: string | null; icon: string | null; item_count: number;
};
export type SharePreview =
  | { kind: "notebook"; notes: { id: string; title: string; text: string }[] }
  | { kind: "deck"; cards: { id: string; concept: string; question: string; hint: string; answer: string }[] };
export type CopyResult = { kind: "notebook" | "deck"; new_id: string; name: string; space_id: string; copied: number; total: number; truncated: boolean; images_removed: number };
export type CloneResult = { space_id: string; name: string; notebooks: number; decks: number; notes: number; cards: number; stickers: number; skipped: number; truncated: boolean; images_removed: number };

const MISSING = "Sharing isn't set up yet. Run migration 39 in Supabase first.";
const fail = (m: string, fallback: string) =>
  /schema cache|does not exist|could not find the (table|function)/i.test(m) ? MISSING : (m.length < 200 ? m : fallback);

export async function loadSharedItems(spaceId: string): Promise<SharedItem[] | null> {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("shared_items_for_space", { p_space: spaceId });
  if (error) return null; // migration 39 not run: the widget stays hidden
  return ((data ?? []) as SharedItem[]).map((r) => ({ ...r, item_count: Number(r.item_count) }));
}

export async function listShareablePicks(spaceId: string): Promise<
  { notebooks: { id: string; name: string; count: number }[]; decks: { id: string; title: string; count: number }[]; picked: string[] } | { error: string }> {
  const { supabase, user } = await authed();
  const [nb, dk, sh, nt] = await Promise.all([
    supabase.from("notebooks").select("id, name").eq("space_id", spaceId).eq("created_by", user.id).order("name"),
    supabase.from("active_recall_decks").select("deck_id, title, cards_json").eq("space_id", spaceId).eq("created_by", user.id).order("title"),
    supabase.from("space_shared_items").select("item_id").eq("space_id", spaceId).eq("owner_id", user.id),
    supabase.from("notes").select("notebook_id").eq("space_id", spaceId).eq("created_by", user.id).not("notebook_id", "is", null),
  ]);
  if (nb.error) return { error: fail(nb.error.message, "Couldn't load your notebooks.") };
  if (sh.error) return { error: fail(sh.error.message, "Couldn't load what you share.") };
  const counts = new Map<string, number>();
  for (const n of (nt.data ?? []) as { notebook_id: string }[]) counts.set(n.notebook_id, (counts.get(n.notebook_id) ?? 0) + 1);
  return {
    notebooks: ((nb.data ?? []) as { id: string; name: string }[]).map((n) => ({ id: n.id, name: n.name, count: counts.get(n.id) ?? 0 })),
    decks: ((dk.data ?? []) as { deck_id: string; title: string; cards_json: unknown[] | null }[]).map((d) => ({ id: d.deck_id, title: d.title, count: d.cards_json?.length ?? 0 })),
    picked: ((sh.data ?? []) as { item_id: string }[]).map((r) => r.item_id),
  };
}

// Replaces the owner's showcase in this space with exactly these items. RLS checks ownership of every row.
export async function saveSharePicks(spaceId: string, notebookIds: string[], deckIds: string[]): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  const { data: cur, error } = await supabase.from("space_shared_items").select("id, kind, item_id").eq("space_id", spaceId).eq("owner_id", user.id);
  if (error) return { error: fail(error.message, "Couldn't save. Try again.") };
  const want = new Map<string, "notebook" | "deck">();
  notebookIds.slice(0, 100).forEach((id) => want.set(id, "notebook"));
  deckIds.slice(0, 100).forEach((id) => want.set(id, "deck"));
  const have = (cur ?? []) as { id: string; kind: string; item_id: string }[];
  const remove = have.filter((r) => !want.has(r.item_id)).map((r) => r.id);
  const add = [...want.entries()].filter(([id]) => !have.some((r) => r.item_id === id)).map(([item_id, kind]) => ({ space_id: spaceId, owner_id: user.id, kind, item_id }));
  if (remove.length) {
    const { error: e } = await supabase.from("space_shared_items").delete().in("id", remove);
    if (e) return { error: fail(e.message, "Couldn't save. Try again.") };
  }
  if (add.length) {
    const { error: e } = await supabase.from("space_shared_items").insert(add);
    if (e) return { error: fail(e.message, "Couldn't share one of those items. Try again.") };
  }
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}

// Plain text only: other people's note HTML is never rendered.
export async function previewShare(shareId: string, kind: "notebook" | "deck"): Promise<SharePreview | { error: string }> {
  const { supabase } = await authed();
  if (kind === "notebook") {
    const { data, error } = await supabase.rpc("shared_notebook_preview", { p_share_id: shareId });
    if (error) return { error: fail(error.message, "Couldn't open the preview.") };
    return { kind, notes: ((data ?? []) as { note_id: string; title: string; body: string }[]).map((n) => ({ id: n.note_id, title: n.title || "Untitled note", text: noteText(n.body).slice(0, 20000) })) };
  }
  const { data, error } = await supabase.rpc("shared_deck_preview", { p_share_id: shareId });
  if (error) return { error: fail(error.message, "Couldn't open the preview.") };
  return { kind, cards: ((data ?? []) as { card_id: string; concept: string; question: string; hint: string; answer: string }[]).map((c, i) => ({ id: c.card_id ?? String(i), concept: c.concept, question: c.question, hint: c.hint, answer: c.answer })) };
}

export async function myOtherSpaces(): Promise<{ id: string; name: string }[]> {
  const { supabase } = await authed();
  const { data } = await supabase.from("spaces").select("id, name").order("created_at");
  return (data ?? []) as { id: string; name: string }[];
}

export async function copySharedItem(shareId: string, targetSpace: string): Promise<CopyResult | { error: string }> {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("copy_shared_item", { p_share_id: shareId, p_target_space: targetSpace });
  if (error) return { error: fail(error.message, "Couldn't copy that. Try again.") };
  revalidatePath(`/spaces/${targetSpace}`);
  revalidatePath(`/spaces/${targetSpace}/notes`);
  return data as CopyResult;
}

export async function getCloneOptions(spaceId: string): Promise<{ design: boolean; content: boolean } | { error: string }> {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("public_space_clone_options", { p_space: spaceId });
  if (error) return { error: fail(error.message, "Couldn't check what can be copied.") };
  const row = (Array.isArray(data) ? data[0] : data) as { allow_design: boolean; allow_content: boolean } | undefined;
  if (!row) return { error: "This space is not open to copy." };
  return { design: !!row.allow_design, content: !!row.allow_content };
}

// Creator only (checked in the function). Failures are not fatal for publishing.
export async function setCloneOptions(spaceId: string, design: boolean, content: boolean): Promise<{ error?: string }> {
  const { supabase } = await authed();
  const { error } = await supabase.rpc("set_space_clone_options", { p_space: spaceId, p_design: design, p_content: content });
  return error ? { error: fail(error.message, "Couldn't save the copy options.") } : {};
}

// Creator only: keeps the saved home layout in step so copies can start from it.
export async function saveDesignLayout(spaceId: string, layout: unknown): Promise<{ error?: string }> {
  const { supabase } = await authed();
  if (!Array.isArray(layout)) return {};
  const clean = layout.filter((e) => e && typeof e.id === "string").slice(0, 60)
    .map((e) => ({ id: String(e.id).slice(0, 40), visible: e.visible !== false, ...(e.half ? { half: true } : {}) }));
  const { error } = await supabase.rpc("set_space_design_layout", { p_space: spaceId, p_layout: clean });
  return error ? { error: fail(error.message, "Couldn't save the layout.") } : {};
}

const IMG_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// With a view-link token (migration 40) the space is copied through that link instead of because it is public.
export async function cloneSpace(spaceId: string, withDesign: boolean, withContent: boolean, viewToken?: string): Promise<CloneResult | { error: string }> {
  const { supabase, user } = await authed();
  const { data, error } = viewToken
    ? await supabase.rpc("clone_space_via_link", { p_token: viewToken, p_with_design: withDesign, p_with_content: withContent })
    : await supabase.rpc("clone_public_space", { p_space: spaceId, p_with_design: withDesign, p_with_content: withContent });
  if (error) return { error: fail(error.message, "Couldn't copy that space. Try again.") };
  const res = data as CloneResult & { pending_images?: { id: string; path: string }[]; header_path?: string | null };
  let skipped = 0;
  let stickerSkips = 0;

  // Image stickers: copy each file into the copier's own folder, never reference the creator's file.
  for (const p of res.pending_images ?? []) {
    try {
      const ext = (p.path.split(".").pop() ?? "").toLowerCase();
      if (!IMG_EXT[ext] || p.path.includes("..")) throw new Error("type");
      const { data: blob, error: dErr } = await supabase.storage.from(WIDGET_BUCKET).download(p.path);
      if (dErr || !blob || blob.size > MAX_IMAGE_BYTES) throw new Error("download");
      const dest = `${user.id}/${res.space_id}/${crypto.randomUUID()}.${ext}`;
      const { error: uErr } = await supabase.storage.from(WIDGET_BUCKET).upload(dest, blob, { contentType: IMG_EXT[ext] });
      if (uErr) throw new Error("upload");
      await supabase.rpc("inherit_media_review", { p_bucket: WIDGET_BUCKET, p_src: p.path, p_dest: dest }); // the source was visible to the copier, so it was cleared
      const { data: row } = await supabase.from("space_widgets").select("data").eq("id", p.id).maybeSingle();
      const { pending: _pending, ...rest } = ((row?.data ?? {}) as Record<string, unknown>);
      void _pending;
      const { error: mErr } = await supabase.from("space_widgets").update({ data: { ...rest, source: "upload", path: dest } }).eq("id", p.id);
      if (mErr) { await supabase.storage.from(WIDGET_BUCKET).remove([dest]); throw new Error("save"); }
    } catch {
      skipped++; stickerSkips++;
      await supabase.from("space_widgets").delete().eq("id", p.id);
    }
  }

  // Header image: copy the file into the new space's own folder.
  if (res.header_path) {
    try {
      const { data: blob, error: dErr } = await supabase.storage.from(HEADER_BUCKET).download(res.header_path);
      if (dErr || !blob) throw new Error("download");
      const dest = `${res.space_id}/${crypto.randomUUID()}.jpg`;
      const { error: uErr } = await supabase.storage.from(HEADER_BUCKET).upload(dest, blob, { contentType: "image/jpeg" });
      if (uErr) throw new Error("upload");
      await supabase.rpc("inherit_media_review", { p_bucket: HEADER_BUCKET, p_src: res.header_path, p_dest: dest });
      const { error: hErr } = await supabase.rpc("set_space_header", { p_space: res.space_id, p_kind: "image", p_color: null, p_path: dest });
      if (hErr) { await supabase.storage.from(HEADER_BUCKET).remove([dest]); throw new Error("save"); }
    } catch { skipped++; }
  }

  revalidatePath("/spaces");
  return { space_id: res.space_id, name: res.name, notebooks: res.notebooks, decks: res.decks, notes: res.notes, cards: res.cards, stickers: Math.max(0, res.stickers - stickerSkips), skipped, truncated: res.truncated, images_removed: res.images_removed };
}
