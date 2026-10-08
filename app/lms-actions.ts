"use server";

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export type LmsConnection = { id: string; label: string; created_at: string; last_used_at: string | null };
export type LmsItem = {
  id: string; source: string; source_id: string; title: string; course: string; course_code: string;
  item_type: "assignment" | "quiz" | "discussion" | "checklist" | "event" | "other";
  due_at: string | null; url: string; completed: boolean; synced_at: string;
};

const MISSING = "School sync needs a database update. Run supabase/migration-29-lms-sync.sql.";
const nice = (m: string) => (/lms_|schema cache|does not exist/i.test(m) ? MISSING : "Couldn't do that. Try again.");

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

/** Make a connection code. The plain code is returned once; only its sha256 hash is stored. */
export async function createLmsConnection(): Promise<{ code: string } | { error: string }> {
  try {
    const { supabase, user } = await authed();
    const { count } = await supabase.from("lms_connections").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= 5) return { error: "You already have 5 connection codes. Revoke one first." };
    const code = randomBytes(32).toString("base64url");
    const token_hash = createHash("sha256").update(code, "utf8").digest("hex");
    const { error } = await supabase.from("lms_connections").insert({ user_id: user.id, token_hash, label: "School sync" });
    if (error) return { error: nice(error.message) };
    return { code };
  } catch (e) { return { error: e instanceof Error ? e.message : "Couldn't make a code." }; }
}

export async function listLmsConnections(): Promise<{ connections: LmsConnection[]; itemCount: number; lastSync: string | null } | { error: string }> {
  try {
    const { supabase } = await authed();
    const [c, i] = await Promise.all([
      supabase.from("lms_connections").select("id,label,created_at,last_used_at").order("created_at", { ascending: false }),
      supabase.from("lms_items").select("synced_at", { count: "exact" }).is("removed_at", null).order("synced_at", { ascending: false }).limit(1),
    ]);
    if (c.error) return { error: nice(c.error.message) };
    if (i.error) return { error: nice(i.error.message) };
    return {
      connections: (c.data ?? []) as LmsConnection[],
      itemCount: i.count ?? 0,
      lastSync: (i.data?.[0] as { synced_at?: string } | undefined)?.synced_at ?? null,
    };
  } catch (e) { return { error: e instanceof Error ? e.message : "Couldn't load." }; }
}

export async function revokeLmsConnection(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await authed();
    const { error } = await supabase.from("lms_connections").delete().eq("id", id);
    return error ? { error: nice(error.message) } : {};
  } catch (e) { return { error: e instanceof Error ? e.message : "Couldn't revoke." }; }
}

/** Synced school items due in a window (not removed). Returns an empty list if migration 29 isn't run yet. */
export async function listLmsItems(fromIso: string, toIso: string): Promise<{ items: LmsItem[] }> {
  try {
    const { supabase } = await authed();
    const { data, error } = await supabase.from("lms_items")
      .select("id,source,source_id,title,course,course_code,item_type,due_at,url,completed,synced_at")
      .is("removed_at", null).not("due_at", "is", null).gte("due_at", fromIso).lte("due_at", toIso).order("due_at").limit(500);
    if (error) return { items: [] };
    return { items: (data ?? []) as LmsItem[] };
  } catch { return { items: [] }; }
}
