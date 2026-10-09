"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/server/admin";

// Admin side of upload safety (migration 43). Every RPC re-checks is_logia_admin() in the database.

export type PendingUpload = {
  bucket: string; path: string; kind: string; outcome: string; category: string | null; reason: string | null;
  frames: string[] | null; created_at: string; user_id: string; email: string | null; strikes: number; url: string | null;
};
export type UserLookup = { id: string; email: string; banned: boolean; blockedUntil: string | null; strikes: { kind: string; reason: string; ref: string | null; at: string }[] };
export type MediaAction = "approve" | "remove" | "strike" | "preserve";

async function adminOnly() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) throw new Error("Admins only");
  return supabase;
}
const MISSING = "Upload review needs a database update. Run supabase/migration-43-upload-safety.sql.";
const nice = (m: string, f: string) => (/schema cache|does not exist|could not find/i.test(m) ? MISSING : f);

export async function listPendingUploads(): Promise<{ items: PendingUpload[] } | { error: string }> {
  const supabase = await adminOnly();
  const { data, error } = await supabase.rpc("admin_pending_media");
  if (error) return { error: nice(error.message, "Couldn't load uploads awaiting review.") };
  const rows = (data ?? []) as Omit<PendingUpload, "url">[];
  const items = await Promise.all(rows.map(async (r) => {
    // Pictures are shown from storage; videos are shown as the frames that were taken in the browser.
    const url = r.kind === "image" ? (await supabase.storage.from(r.bucket).createSignedUrl(r.path, 900)).data?.signedUrl ?? null : null;
    return { ...r, url };
  }));
  return { items };
}

export async function reviewUploadAction(bucket: string, path: string, action: MediaAction, note: string): Promise<{ message: string } | { error: string }> {
  const supabase = await adminOnly();
  const { data, error } = await supabase.rpc("admin_media_action", { p_bucket: bucket, p_path: path, p_action: action, p_note: note.slice(0, 300) });
  if (error) return { error: nice(error.message, "Couldn't save that decision.") };
  const res = (data ?? {}) as { strikes?: number; banned?: boolean; blocked?: boolean };
  // Removed files are deleted from storage. Preserved files are kept on purpose.
  if (action === "remove" || action === "strike") await supabase.storage.from(bucket).remove([path]);
  if (action === "approve") return { message: "Approved." };
  if (action === "remove") return { message: "Removed." };
  if (action === "preserve") return { message: "Hidden from everyone and kept as evidence. The account is banned. Follow the reporting steps below." };
  return { message: res.banned ? `Removed. Strike ${res.strikes}: the account is banned.` : res.blocked ? `Removed. Strike ${res.strikes}: uploads and hosting are blocked for 30 days.` : `Removed. Strike ${res.strikes ?? 1}.` };
}

export async function lookupUser(email: string): Promise<{ user: UserLookup } | { error: string }> {
  const supabase = await adminOnly();
  const { data, error } = await supabase.rpc("admin_user_lookup", { p_email: email });
  if (error) return { error: nice(error.message, "Couldn't look that person up.") };
  if (!data) return { error: "No account with that email." };
  return { user: data as UserLookup };
}

export async function setBan(userId: string, banned: boolean, reason: string): Promise<{ error?: string }> {
  const supabase = await adminOnly();
  const { error } = await supabase.rpc("admin_set_ban", { p_user: userId, p_banned: banned, p_reason: reason.slice(0, 300) });
  return error ? { error: nice(error.message, "Couldn't change that account.") } : {};
}
