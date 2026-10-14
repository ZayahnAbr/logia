"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const clean = (v: unknown, max = 40) => String(v ?? "").trim().slice(0, max);
const list = (v: unknown, allowed: string[]) => (Array.isArray(v) ? v.map((x) => clean(x)).filter((x) => allowed.includes(x)) : []);

const ROLES = ["student", "undergrad", "postgrad", "other"];
const GOALS = ["notes", "flashcards", "papers", "exams", "lectures", "together", "maths"];
const SETUP = ["files", "extension", "recordings", "outlines", "pdfs", "none"];
const PERSONA: Record<string, string> = { student: "high_school", undergrad: "university", postgrad: "university", other: "self_learner" };

export type OnboardingAnswers = { roles?: string[]; goals?: string[]; setup?: string[]; plan?: "standard" | "pro"; code?: string };

// Saves what the student told us. Every field is optional so each step can save on its own, and a
// missing column (migration 46 not run) never blocks onboarding.
export async function saveOnboarding(a: OnboardingAnswers) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  const patch: Record<string, unknown> = {};
  if (a.roles) patch.roles = list(a.roles, ROLES);
  if (a.goals) patch.goals = list(a.goals, GOALS);
  if (a.setup) patch.setup = list(a.setup, SETUP);
  if (a.plan === "standard" || a.plan === "pro") patch.plan = a.plan;
  if (typeof a.code === "string") patch.code = clean(a.code, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const { data } = await supabase.from("profiles").select("onboarding").eq("id", user.id).maybeSingle();
  const next = { ...((data?.onboarding as object) ?? {}), ...patch, updated_at: new Date().toISOString() };
  const upd: Record<string, unknown> = { onboarding: next };
  const roles = patch.roles as string[] | undefined;
  if (roles?.length) upd.persona = PERSONA[roles.includes("postgrad") ? "postgrad" : roles.includes("undergrad") ? "undergrad" : roles[0]];
  let { error } = await supabase.from("profiles").update(upd).eq("id", user.id);
  if (error && upd.persona) ({ error } = await supabase.from("profiles").update({ persona: upd.persona }).eq("id", user.id));
  return error ? { error: "Couldn't save that, but you can carry on." } : {};
}

export async function getMyInviteLink(): Promise<{ code: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_referral_code");
  return error || !data ? { error: "Your invite link isn't ready yet. You'll find it under Invite friends." } : { code: data as string };
}

// A small sample space so the tour can spotlight every tool. The student can delete it like any space.
export async function createDemoSpace(existingId?: string): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  let spaceId = existingId ?? "";
  if (!spaceId) {
    // Insert first, then read the id back (the row only becomes visible once the creator is added as a member).
    const { error } = await supabase.from("spaces").insert({ name: "Demo space", subject: "Biology", type: "peer", created_by: user.id });
    if (error) return { error: "Couldn't set up the demo space." };
    const { data } = await supabase.from("spaces").select("id").eq("created_by", user.id).order("created_at", { ascending: false }).limit(1).single();
    if (!data) return { error: "Couldn't set up the demo space." };
    spaceId = data.id as string;
  }
  if (!existingId) await supabase.from("notes").insert({
    space_id: spaceId, folder: "General", created_by: user.id, title: "Welcome to your space",
    body: "<h2>Cell biology</h2><p>The cell is the basic unit of life. Mitochondria release energy for the cell, and the nucleus holds its DNA.</p><p>Try selecting this text: Logia can turn your notes into flashcards that test you.</p>",
  });
  // A heading, a sticky note, so the tour has real stickers to point at. Tolerates a missing sticky table.
  await supabase.from("space_widgets").insert([
    { user_id: user.id, space_id: spaceId, kind: "text", data: { text: existingId ? "My study space" : "Biology: exam on Friday", size: "heading", w: 300 } },
    { user_id: user.id, space_id: spaceId, kind: "sticky", data: { text: "Revise chapter 4", color: "yellow", w: 150 } },
  ]);
  revalidatePath("/spaces");
  return { id: spaceId };
}

// Records a file the browser already uploaded straight to storage (big files can't pass through a server action).
export async function registerUploadedFile(spaceId: string, folder: string, name: string, path: string, size: number, mime: string): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  if (!path.startsWith(`${spaceId}/`)) return { error: "That upload doesn't match this space." };
  const { data, error } = await supabase.from("files").insert({ space_id: spaceId, folder: clean(folder, 60) || "General", name: clean(name, 200), path, size_bytes: Math.max(0, Math.round(size)), mime_type: clean(mime, 100), uploaded_by: user.id }).select("id").single();
  if (error || !data) { await supabase.storage.from("space-files").remove([path]); return { error: "Couldn't save that file." }; }
  return { id: data.id as string };
}
