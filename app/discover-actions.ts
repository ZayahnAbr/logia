"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/server/admin";
import { cleanChatMessage, hasBlockedWord, isBlockedError, NOT_SENT_NOTE } from "@/lib/moderation";
import { scanSpaceForPublic, flagsToItems } from "@/lib/server/safety";
import { normaliseTags, isLevel } from "@/lib/spaceTags";
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
export async function postCafeMessage(roomId: string, text: string): Promise<{ id: string; body: string } | { error: string; blocked?: boolean }> {
  return postMessage({ room_id: roomId }, text);
}

export async function postUserCafeMessage(cafeId: string, text: string): Promise<{ id: string; body: string } | { error: string; blocked?: boolean }> {
  return postMessage({ cafe_id: cafeId }, text);
}

async function postMessage(target: { room_id: string } | { cafe_id: string }, text: string): Promise<{ id: string; body: string } | { error: string; blocked?: boolean }> {
  const { supabase, user } = await authed();
  const clean = cleanChatMessage(text);
  if (!clean.ok) return { error: clean.error, blocked: clean.blocked };

  const { data: prof } = await supabase.from("profiles").select("display_name, avatar_color, avatar_icon").eq("id", user.id).maybeSingle();
  const author = prof?.display_name || (user.user_metadata?.display_name as string) || user.email?.split("@")[0] || "Student";
  const { data, error } = await supabase.from("cafe_messages")
    .insert({ ...target, user_id: user.id, author, author_color: prof?.avatar_color ?? null, author_icon: prof?.avatar_icon ?? null, body: clean.body })
    .select("id, body").single();
  if (error) {
    if (isBlockedError(error.message)) return { error: NOT_SENT_NOTE, blocked: true };
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

// ── Making a space public ─────────────────────────────────────
export type PublicState = { status: "private" | "pending" | "public" | "rejected"; tags: string[]; institution: string; level: string };
export type PublishOutcome = { error?: string; status?: "public" | "pending" | "private"; message?: string };
export type PublishInput = { description: string; tags: string[]; institution: string; level: string; allowDesign?: boolean; allowContent?: boolean };

const PENDING_MESSAGE = "Thanks. We're checking your space before it appears on Discover. It stays private until then, and you don't need to do anything.";

export async function getMyPublicState(spaceId: string): Promise<PublicState | null> {
  const { supabase } = await authed();
  const { data } = await supabase.rpc("my_space_public_state", { p_space: spaceId });
  const row = (Array.isArray(data) ? data[0] : data) as { public_status: PublicState["status"]; tags: string[] | null; institution: string | null; level: string | null } | null;
  return row ? { status: row.public_status, tags: row.tags ?? [], institution: row.institution ?? "", level: row.level ?? "" } : null;
}

// Publishing always goes through a check first. Only publish_space() (which needs MODERATION_SECRET) can list a space.
export async function publishSpace(spaceId: string, input: PublishInput): Promise<PublishOutcome> {
  const { supabase } = await authed();
  const description = input.description.trim().slice(0, 280);
  if (!description) return { error: "Add a short description so people know what the space is for." };
  const tags = normaliseTags(input.tags);
  const institution = input.institution.trim().slice(0, 60);
  if (hasBlockedWord(description) || hasBlockedWord(tags.join(" ")) || hasBlockedWord(institution)) {
    return { error: "The description, tags or school can't be shown publicly. Edit them, then try again." };
  }
  const level = isLevel(input.level) ? input.level : "";
  const scan = await scanSpaceForPublic(spaceId, { description, tags, institution, allowDesign: input.allowDesign, allowContent: input.allowContent });
  const secret = process.env.MODERATION_SECRET;
  let verdict: "clean" | "pending" | "private" = scan.verdict === "clean" ? "clean" : scan.verdict === "pending" ? "pending" : "private";
  let items = flagsToItems(scan.flags, scan.unavailable);
  if (verdict === "clean" && !secret) { verdict = "pending"; items = [{ kind: "system", ref: "Automatic check", reason: "Publishing is not fully set up on the server" }]; }
  const { data, error } = await supabase.rpc("publish_space", {
    p_space: spaceId, p_description: description, p_tags: tags, p_institution: institution, p_level: level, p_verdict: verdict, p_items: items, p_secret: secret ?? null,
  });
  if (error) {
    if (isBlockedError(error.message)) return { error: "The name, description, tags or school can't be shown publicly. Edit them, then try again." };
    return { error: nice(error.message, error.message.includes("creator") ? "Only the creator of a space can change this." : "Couldn't update the space. Try again.") };
  }
  revalidatePath(`/spaces/${spaceId}`);
  const status = data as string;
  if (status === "public") return { status: "public", message: "Your space is now public." };
  if (status === "pending") return { status: "pending", message: PENDING_MESSAGE };
  return { status: "private", message: scan.ownerMessage || "Your space is still private." };
}

export async function makeSpacePrivate(spaceId: string): Promise<{ error?: string }> {
  const { supabase } = await authed();
  const { error } = await supabase.rpc("set_space_public", { p_space_id: spaceId, p_public: false, p_description: null });
  if (error) return { error: nice(error.message, error.message.includes("creator") ? "Only the creator of a space can change this." : "Couldn't update the space. Try again.") };
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}

// Re-check a public space after its name, description, shared items or design changed (debounced in the database, claimed once).
// If it is newly flagged it moves to review; nothing is deleted. If the check cannot run, the space stays as it is and tries again later.
export async function rescanIfDue(spaceId: string): Promise<void> {
  try {
    const { supabase } = await authed();
    const { data: claimed } = await supabase.rpc("claim_rescan", { p_space: spaceId });
    if (!claimed) return;
    const scan = await scanSpaceForPublic(spaceId);
    const flagged = scan.flags.length > 0;
    const verdict = flagged ? "pending" : scan.unavailable ? "unavailable" : "clean";
    await supabase.rpc("record_rescan", { p_space: spaceId, p_verdict: verdict, p_items: flagsToItems(scan.flags, false), p_secret: process.env.MODERATION_SECRET ?? null });
  } catch { /* never breaks the page that asked */ }
}

// ── Discover: filtered public spaces ──────────────────────────
export type DiscoverFilters = { q?: string; tags?: string[]; level?: string; institution?: string; sort?: "members" | "newest" | "copied" };
export type DiscoverSpace = PublicSpace & { tags: string[]; institution: string | null; level: string | null; copy_count: number };
export type Facets = { tags: { value: string; n: number }[]; levels: { value: string; n: number }[]; institutions: { value: string; n: number }[] };

export async function listDiscoverSpaces(f: DiscoverFilters): Promise<{ spaces: DiscoverSpace[]; facets: Facets } | { error: string }> {
  const { supabase } = await authed();
  const [list, fac] = await Promise.all([
    supabase.rpc("discover_spaces", { p_q: (f.q ?? "").slice(0, 80) || null, p_tags: f.tags?.length ? normaliseTags(f.tags) : null, p_level: isLevel(f.level) ? f.level : null, p_institution: (f.institution ?? "").slice(0, 60) || null, p_sort: f.sort ?? "members" }),
    supabase.rpc("discover_space_facets"),
  ]);
  if (list.error) {
    // Before migration 41: fall back to the plain list.
    const plain = await listPublicSpaces();
    if ("error" in plain) return plain;
    return { spaces: plain.spaces.map((s) => ({ ...s, tags: [], institution: null, level: null, copy_count: 0 })), facets: { tags: [], levels: [], institutions: [] } };
  }
  const rows = (fac.data ?? []) as { kind: string; value: string; n: number | string }[];
  const pick = (k: string) => rows.filter((r) => r.kind === k).map((r) => ({ value: r.value, n: Number(r.n) })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
  return {
    spaces: ((list.data ?? []) as DiscoverSpace[]).map((s) => ({ ...s, member_count: Number(s.member_count), copy_count: Number(s.copy_count), tags: s.tags ?? [] })),
    facets: { tags: pick("tag"), levels: pick("level"), institutions: pick("institution") },
  };
}

// ── Admin: spaces waiting for review ──────────────────────────
export type PendingSpace = { space_id: string; name: string; owner_name: string; public_description: string | null; tags: string[]; requested_at: string; reports: { id: string; kind: string; ref: string; reason: string }[] };

export async function listPendingSpaces(): Promise<{ spaces: PendingSpace[] } | { error: string }> {
  const { supabase } = await adminOnly();
  const { data, error } = await supabase.rpc("admin_pending_spaces");
  if (error) return { error: nice(error.message, "Couldn't load spaces waiting for review.") };
  return { spaces: ((data ?? []) as PendingSpace[]).map((s) => ({ ...s, tags: s.tags ?? [], reports: s.reports ?? [] })) };
}

export async function reviewSpace(spaceId: string, approve: boolean): Promise<{ error?: string }> {
  const { supabase } = await adminOnly();
  const { error } = await supabase.rpc("admin_review_space", { p_space: spaceId, p_approve: approve });
  if (error) return { error: nice(error.message, "Couldn't save that decision.") };
  revalidatePath("/discover/admin");
  revalidatePath("/discover");
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
