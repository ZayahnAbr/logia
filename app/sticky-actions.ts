"use server";

import { createClient } from "@/lib/supabase/server";

export type Sticky = { id: string; body: string; color: string; updated_at: string };
const COLORS = ["yellow", "pink", "blue", "green", "peach"];
const MISSING = "Sticky notes need a database update. Run supabase/migration-16-sticky-notes.sql.";
const nice = (m: string) => (/sticky_notes|schema cache|does not exist/i.test(m) ? MISSING : "Couldn't save the sticky note. Try again.");

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

export async function listStickies(spaceId: string): Promise<{ notes: Sticky[] } | { error: string }> {
  const { supabase } = await authed();
  const { data, error } = await supabase.from("sticky_notes").select("id, body, color, updated_at").eq("space_id", spaceId).order("created_at");
  return error ? { error: nice(error.message) } : { notes: (data ?? []) as Sticky[] };
}

export async function addSticky(spaceId: string, color: string) {
  const { supabase, user } = await authed();
  const { data, error } = await supabase.from("sticky_notes")
    .insert({ user_id: user.id, space_id: spaceId, color: COLORS.includes(color) ? color : "yellow" })
    .select("id, body, color, updated_at").single();
  return error ? { error: nice(error.message) } : { note: data as Sticky };
}

export async function updateSticky(id: string, patch: { body?: string; color?: string }) {
  const { supabase } = await authed();
  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.body === "string") clean.body = patch.body.slice(0, 2000);
  if (patch.color && COLORS.includes(patch.color)) clean.color = patch.color;
  const { error } = await supabase.from("sticky_notes").update(clean).eq("id", id);
  return error ? { error: nice(error.message) } : {};
}

export async function deleteSticky(id: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("sticky_notes").delete().eq("id", id);
  return error ? { error: nice(error.message) } : {};
}
