"use server";

import { createClient } from "@/lib/supabase/server";
import { ClassroomError, classroomMessage, runClassroomSync } from "@/lib/server/classroom";

export type ClassroomStatus = { count: number; lastSync: string | null; hasGoogle: boolean };

export async function getClassroomStatus(): Promise<ClassroomStatus> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { count: 0, lastSync: null, hasGoogle: false };
    const { data, count } = await supabase.from("lms_items").select("synced_at", { count: "exact" })
      .eq("source", "google_classroom").is("removed_at", null).order("synced_at", { ascending: false }).limit(1);
    return {
      count: count ?? 0,
      lastSync: (data?.[0] as { synced_at?: string } | undefined)?.synced_at ?? null,
      hasGoogle: !!user.identities?.some((i) => i.provider === "google"),
    };
  } catch { return { count: 0, lastSync: null, hasGoogle: false }; }
}

/** Sync using the Google token from the current sign-in session. It is not stored, so it only works for about an hour after connecting. */
export async function syncClassroom(): Promise<{ count: number; undated: number } | { error: string; reconnect?: boolean }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not signed in" };
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.provider_token;
    if (!token) return { error: "Connect Google Classroom first. Google's access isn't kept after about an hour.", reconnect: true };
    const r = await runClassroomSync(supabase, user.id, token);
    return { count: r.count, undated: r.undated };
  } catch (e) {
    return { error: classroomMessage(e), reconnect: e instanceof ClassroomError && (e.kind === "expired" || e.kind === "forbidden") };
  }
}

export async function removeClassroomItems(): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("lms_items").delete().eq("source", "google_classroom");
    return error ? { error: "Couldn't remove them. Try again." } : {};
  } catch { return { error: "Couldn't remove them. Try again." }; }
}
