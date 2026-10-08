"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/server/admin";
import { cleanChatMessage } from "@/lib/moderation";
import { parseYouTubeId } from "@/lib/youtube";

export type PublicSpace = { id: string; name: string; subject: string | null; public_description: string | null; member_count: number; created_at: string };
export type Stream = { id: string; title: string; channel: string; youtube_id: string; kind: "live" | "video"; is_active: boolean; sort: number };
export type ReportKind = "cafe_message" | "space" | "stream" | "user_cafe";
export type OpenReport = {
  id: string; kind: ReportKind; target_id: string; reason: string; created_at: string;
  target: { title: string; detail: string; hidden: boolean } | null;
};

const MISSING = "Discover needs a database update. Run supabase/migration-22-discover.sql and supabase/migration-23-user-cafes.sql.";
const nice = (m: string, fallback: string) => (/schema cache|does not exist|could not find the (table|function)/i.test(m) ? MISSING : fallback);

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

async function adminOnly() {
  const ctx = await authed();
  if (!isAdmin(ctx.user.email)) throw new Error("Admins only");
  return ctx;
}

// ── Cafe chat ─────────────────────────────────────────────────
export async function postCafeMessage(roomId: string, text: string): Promise<{ id: string; body: string } | { error: string }> {
  return postMessage({ room_id: roomId }, text);
}

export async function postUserCafeMessage(cafeId: string, text: string): Promise<{ id: string; body: string } | { error: string }> {
  return postMessage({ cafe_id: cafeId }, text);
}

async function postMessage(target: { room_id: string } | { cafe_id: string }, text: string): Promise<{ id: string; body: string } | { error: string }> {
  const { supabase, user } = await authed();
  const clean = cleanChatMessage(text);
  if (!clean.ok) return { error: clean.error };

  const { data: prof } = await supabase.from("profiles").select("display_name, avatar_color, avatar_icon").eq("id", user.id).maybeSingle();
  const author = prof?.display_name || (user.user_metadata?.display_name as string) || user.email?.split("@")[0] || "Student";
  const { data, error } = await supabase.from("cafe_messages")
    .insert({ ...target, user_id: user.id, author, author_color: prof?.avatar_color ?? null, author_icon: prof?.avatar_icon ?? null, body: clean.body })
    .select("id, body").single();
  if (error) {
    if (/row-level security|policy/i.test(error.message)) {
      const { data: phase } = "room_id" in target ? await supabase.rpc("cafe_phase", { p_room_id: target.room_id }) : await supabase.rpc("user_cafe_phase", { p_cafe_id: target.cafe_id });
      return { error: phase === "focus" ? "Chat is resting until the break." : "Slow down a little. You can send one message every 5 seconds." };
    }
    return { error: nice(error.message, "Couldn't send that message. Try again.") };
  }
  return { id: data.id as string, body: data.body as string };
}

// ── Reports ───────────────────────────────────────────────────
export async function reportContent(kind: ReportKind, targetId: string, reason: string): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  if (!["cafe_message", "space", "stream", "user_cafe"].includes(kind)) return { error: "Unknown report type." };
  const { error } = await supabase.from("content_reports").insert({ reporter_id: user.id, kind, target_id: targetId, reason: reason.trim().slice(0, 500) });
  return error ? { error: nice(error.message, "Couldn't send the report. Try again.") } : {};
}

// ── Public spaces ─────────────────────────────────────────────
export async function listPublicSpaces(): Promise<{ spaces: PublicSpace[] } | { error: string }> {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("list_public_spaces");
  if (error) return { error: nice(error.message, "Couldn't load public spaces. Try again.") };
  return { spaces: ((data ?? []) as PublicSpace[]).map((s) => ({ ...s, member_count: Number(s.member_count) })) };
}

export async function joinPublicSpace(spaceId: string): Promise<{ id: string } | { error: string }> {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("join_public_space", { p_space_id: spaceId });
  if (error) return { error: nice(error.message, error.message.includes("not open") ? "This space is no longer open to join." : "Couldn't join that space. Try again.") };
  revalidatePath("/spaces");
  return { id: (data as string) ?? spaceId };
}

// Creator only: the RPC checks created_by = auth.uid() (the spaces RLS may not allow the creator to update directly).
export async function setSpacePublic(spaceId: string, isPublic: boolean, description: string): Promise<{ error?: string }> {
  const { supabase } = await authed();
  const { error } = await supabase.rpc("set_space_public", { p_space_id: spaceId, p_public: isPublic, p_description: description });
  if (error) return { error: nice(error.message, error.message.includes("creator") ? "Only the creator of a space can change this." : "Couldn't update the space. Try again.") };
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}

// ── Admin ─────────────────────────────────────────────────────
export async function listOpenReports(): Promise<{ reports: OpenReport[] } | { error: string }> {
  const { supabase } = await adminOnly();
  const { data, error } = await supabase.from("content_reports").select("id, kind, target_id, reason, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(100);
  if (error) return { error: nice(error.message, "Couldn't load reports.") };
  const rows = (data ?? []) as Omit<OpenReport, "target">[];

  const ids = (k: ReportKind) => rows.filter((r) => r.kind === k).map((r) => r.target_id);
  const [msgs, spaces, streams, cafes] = await Promise.all([
    ids("cafe_message").length ? supabase.from("cafe_messages").select("id, author, body, hidden").in("id", ids("cafe_message")) : Promise.resolve({ data: [] }),
    ids("space").length ? supabase.rpc("admin_spaces_brief", { p_ids: ids("space") }) : Promise.resolve({ data: [] }),
    ids("stream").length ? supabase.from("study_streams").select("id, title, channel, is_active").in("id", ids("stream")) : Promise.resolve({ data: [] }),
    ids("user_cafe").length ? supabase.from("user_cafes").select("id, name, description, status").in("id", ids("user_cafe")) : Promise.resolve({ data: [] }),
  ]);
  const byId = <T extends { id: string }>(arr: unknown) => new Map(((arr ?? []) as T[]).map((x) => [x.id, x]));
  const m = byId<{ id: string; author: string; body: string; hidden: boolean }>(msgs.data);
  const s = byId<{ id: string; name: string; subject: string | null; public_description: string | null; hidden: boolean }>(spaces.data);
  const st = byId<{ id: string; title: string; channel: string; is_active: boolean }>(streams.data);

  const uc = byId<{ id: string; name: string; description: string; status: string }>(cafes.data);

  return {
    reports: rows.map((r) => {
      let target: OpenReport["target"] = null;
      if (r.kind === "cafe_message") { const x = m.get(r.target_id); if (x) target = { title: x.author, detail: x.body, hidden: x.hidden }; }
      if (r.kind === "space") { const x = s.get(r.target_id); if (x) target = { title: x.name, detail: x.public_description || x.subject || "No description", hidden: x.hidden }; }
      if (r.kind === "stream") { const x = st.get(r.target_id); if (x) target = { title: x.title, detail: x.channel, hidden: !x.is_active }; }
      if (r.kind === "user_cafe") { const x = uc.get(r.target_id); if (x) target = { title: x.name, detail: x.description || "No description", hidden: x.status === "hidden" }; }
      return { ...r, target };
    }),
  };
}

export async function resolveReport(reportId: string, action: "dismiss" | "hide"): Promise<{ error?: string }> {
  const { supabase } = await adminOnly();
  const { data: rep, error: readErr } = await supabase.from("content_reports").select("kind, target_id").eq("id", reportId).single();
  if (readErr || !rep) return { error: "That report no longer exists." };
  if (action === "hide") {
    if (rep.kind === "cafe_message") {
      const { error } = await supabase.from("cafe_messages").update({ hidden: true }).eq("id", rep.target_id);
      if (error) return { error: nice(error.message, "Couldn't hide that message.") };
    } else if (rep.kind === "space") {
      const { error } = await supabase.rpc("admin_hide_space", { p_space_id: rep.target_id });
      if (error) return { error: nice(error.message, "Couldn't hide that space.") };
    } else if (rep.kind === "user_cafe") {
      const { error } = await supabase.from("user_cafes").update({ status: "hidden" }).eq("id", rep.target_id);
      if (error) return { error: nice(error.message, "Couldn't hide that room.") };
    } else {
      const { error } = await supabase.from("study_streams").update({ is_active: false }).eq("id", rep.target_id);
      if (error) return { error: nice(error.message, "Couldn't turn off that stream.") };
    }
  }
  const { error } = await supabase.from("content_reports").update({ status: "resolved" }).eq("id", reportId);
  if (error) return { error: nice(error.message, "Couldn't close the report.") };
  revalidatePath("/discover/admin");
  return {};
}

export async function listAllStreams(): Promise<{ streams: Stream[] } | { error: string }> {
  const { supabase } = await adminOnly();
  const { data, error } = await supabase.from("study_streams").select("id, title, channel, youtube_id, kind, is_active, sort").order("sort").order("created_at", { ascending: false });
  return error ? { error: nice(error.message, "Couldn't load streams.") } : { streams: (data ?? []) as Stream[] };
}

export async function addStream(url: string, title: string, channel: string, kind: "live" | "video"): Promise<{ stream: Stream } | { error: string }> {
  const { supabase, user } = await adminOnly();
  const youtube_id = parseYouTubeId(url);
  if (!youtube_id) return { error: "That doesn't look like a YouTube link. Paste the video or live stream URL." };
  if (!title.trim()) return { error: "Add a title." };
  const { data, error } = await supabase.from("study_streams")
    .insert({ youtube_id, title: title.trim().slice(0, 140), channel: channel.trim().slice(0, 80), kind: kind === "live" ? "live" : "video", created_by: user.id })
    .select("id, title, channel, youtube_id, kind, is_active, sort").single();
  if (error) return { error: nice(error.message, "Couldn't add the stream.") };
  revalidatePath("/discover");
  return { stream: data as Stream };
}

export async function setStreamActive(id: string, active: boolean): Promise<{ error?: string }> {
  const { supabase } = await adminOnly();
  const { error } = await supabase.from("study_streams").update({ is_active: active }).eq("id", id);
  if (error) return { error: nice(error.message, "Couldn't update the stream.") };
  revalidatePath("/discover");
  return {};
}

export async function deleteStream(id: string): Promise<{ error?: string }> {
  const { supabase } = await adminOnly();
  const { error } = await supabase.from("study_streams").delete().eq("id", id);
  if (error) return { error: nice(error.message, "Couldn't delete the stream.") };
  revalidatePath("/discover");
  return {};
}
