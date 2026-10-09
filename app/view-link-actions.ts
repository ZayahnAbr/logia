"use server";
import { randomBytes } from "node:crypto";
import { authed } from "@/lib/server/llm";
import { createClient } from "@/lib/supabase/server";
import { noteText } from "@/lib/server/rag";
import type { SharePreview } from "@/app/shared-items-actions";

// View links (migration 40): a link that lets anyone look at a space without an account.
export type ViewLink = { id: string; token: string; created_at: string; revoked_at: string | null; view_count: number };

const MISSING = "View links aren't set up yet. Run migration 40 in Supabase first.";
const fail = (m: string, fallback: string) =>
  /schema cache|does not exist|could not find the (table|function)/i.test(m) ? MISSING : (m.length < 200 ? m : fallback);

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export async function listViewLinks(spaceId: string): Promise<{ links: ViewLink[] } | { error: string }> {
  const { supabase } = await authed();
  const { data, error } = await supabase.from("space_view_links")
    .select("id, token, created_at, revoked_at, view_count").eq("space_id", spaceId).is("revoked_at", null).order("created_at", { ascending: false });
  if (error) return { error: fail(error.message, "Couldn't load your links.") };
  return { links: (data ?? []) as ViewLink[] };
}

// The token is made here (32 random bytes, url-safe), never derived from the space id.
export async function createViewLink(spaceId: string): Promise<{ link: ViewLink } | { error: string }> {
  const { supabase } = await authed();
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await supabase.rpc("create_view_link", { p_space: spaceId, p_token: token });
  if (error) return { error: fail(error.message, "Couldn't make the link. Try again.") };
  const r = data as { id: string; token: string; created_at: string; view_count: number };
  return { link: { id: r.id, token: r.token, created_at: r.created_at, revoked_at: null, view_count: r.view_count ?? 0 } };
}

export async function revokeViewLink(id: string): Promise<{ error?: string }> {
  const { supabase } = await authed();
  const { error } = await supabase.rpc("revoke_view_link", { p_id: id });
  return error ? { error: fail(error.message, "Couldn't stop the link. Try again.") } : {};
}

// Public: works without an account. Plain text only, other people's note HTML is never rendered.
export async function previewViewShare(token: string, shareId: string, kind: "notebook" | "deck"): Promise<SharePreview | { error: string }> {
  if (!TOKEN_RE.test(token)) return { error: "This link no longer works." };
  const supabase = await createClient();
  if (kind === "notebook") {
    const { data, error } = await supabase.rpc("view_notebook_preview", { p_token: token, p_share_id: shareId });
    if (error) return { error: fail(error.message, "Couldn't open the preview.") };
    return { kind, notes: ((data ?? []) as { note_id: string; title: string; body: string }[]).map((n) => ({ id: n.note_id, title: n.title || "Untitled note", text: noteText(n.body).slice(0, 20000) })) };
  }
  const { data, error } = await supabase.rpc("view_deck_preview", { p_token: token, p_share_id: shareId });
  if (error) return { error: fail(error.message, "Couldn't open the preview.") };
  return { kind, cards: ((data ?? []) as { card_id: string; concept: string; question: string; hint: string; answer: string }[]).map((c, i) => ({ id: c.card_id ?? String(i), concept: c.concept, question: c.question, hint: c.hint, answer: c.answer })) };
}

// Signed-in people only (the function checks).
export async function copySharedViaLink(token: string, shareId: string, targetSpace: string) {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("copy_shared_via_link", { p_token: token, p_share_id: shareId, p_target_space: targetSpace });
  if (error) return { error: fail(error.message, "Couldn't copy that. Try again.") };
  return data as import("@/app/shared-items-actions").CopyResult;
}
