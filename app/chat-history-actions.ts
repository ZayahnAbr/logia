"use server";
import { authed } from "@/lib/server/llm";
import type { AskSource } from "@/app/actions";

// Saved Ask AI history (migration 36). Every function fails soft: if the table is missing or
// anything goes wrong, the chat simply stays in memory and no error reaches the student.

export type SavedMessage = { role: "user" | "assistant"; content: string; sources?: AskSource[]; grounded?: boolean };
type Surface = "space" | "note";

const LOAD_LIMIT = 50;
const KEEP_LIMIT = 200;
const isId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const clip = (s: string) => (s.length > 8000 ? s.slice(0, 7999) + "…" : s);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scope(q: any, userId: string, spaceId: string, surface: Surface, noteId?: string | null) {
  const base = q.eq("user_id", userId).eq("space_id", spaceId).eq("surface", surface);
  return surface === "note" && noteId ? base.eq("note_id", noteId) : base.is("note_id", null);
}

export async function loadChat(spaceId: string, surface: Surface, noteId?: string | null): Promise<{ available: boolean; messages: SavedMessage[] }> {
  try {
    if (!isId(spaceId) || (surface === "note" && !isId(noteId))) return { available: false, messages: [] };
    const { supabase, user } = await authed();
    const { data, error } = await scope(supabase.from("ai_chat_messages").select("role, content, sources, grounded"), user.id, spaceId, surface, noteId)
      .order("created_at", { ascending: false }).limit(LOAD_LIMIT);
    if (error || !data) return { available: false, messages: [] };
    const messages = (data as Record<string, unknown>[]).reverse().map((r): SavedMessage => ({
      role: r.role as "user" | "assistant",
      content: r.content as string,
      ...(Array.isArray(r.sources) ? { sources: r.sources as AskSource[] } : {}),
      ...(typeof r.grounded === "boolean" ? { grounded: r.grounded } : {}),
    }));
    return { available: true, messages };
  } catch {
    return { available: false, messages: [] };
  }
}

export async function appendChat(
  spaceId: string, surface: Surface, noteId: string | null | undefined,
  userText: string,
  reply?: { content: string; sources?: AskSource[]; grounded?: boolean },
): Promise<{ ok: boolean }> {
  try {
    if (!isId(spaceId) || (surface === "note" && !isId(noteId))) return { ok: false };
    const { supabase, user } = await authed();
    const now = Date.now();
    const note_id = surface === "note" ? noteId! : null;
    const base = { user_id: user.id, space_id: spaceId, surface, note_id };
    const rows: Record<string, unknown>[] = [];
    if (userText.trim()) rows.push({ ...base, role: "user", content: clip(userText), created_at: new Date(now).toISOString() });
    if (reply?.content.trim()) {
      rows.push({
        ...base, role: "assistant", content: clip(reply.content),
        sources: reply.sources && reply.sources.length > 0 ? reply.sources.slice(0, 12) : null,
        grounded: typeof reply.grounded === "boolean" ? reply.grounded : null,
        created_at: new Date(now + 1).toISOString(),
      });
    }
    if (rows.length === 0) return { ok: true };
    const { error } = await supabase.from("ai_chat_messages").insert(rows);
    if (error) return { ok: false };

    // Trim the oldest beyond the cap so a thread cannot grow without limit.
    const { data: old } = await scope(supabase.from("ai_chat_messages").select("id"), user.id, spaceId, surface, noteId)
      .order("created_at", { ascending: false }).range(KEEP_LIMIT, KEEP_LIMIT + 99);
    if (old && old.length > 0) await supabase.from("ai_chat_messages").delete().in("id", (old as { id: string }[]).map((r) => r.id));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function clearChat(spaceId: string, surface: Surface, noteId?: string | null): Promise<{ ok: boolean }> {
  try {
    if (!isId(spaceId) || (surface === "note" && !isId(noteId))) return { ok: false };
    const { supabase, user } = await authed();
    const { error } = await scope(supabase.from("ai_chat_messages").delete(), user.id, spaceId, surface, noteId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
