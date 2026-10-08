"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/server/admin";
import { toEmbed } from "@/lib/musicEmbed";
import { HEX_COLOR, IMAGE_EXT, type CafeInput, type Host, type PendingCafe, type SceneId, type UserCafe, type UserCafeCard } from "@/lib/userCafes";

// User-hosted study-with-me rooms (migration 23).
const SCENES: SceneId[] = ["rain-cafe", "night-library", "forest-cabin", "lofi-desk"];
const CAFE_COLS = "id, owner_id, name, description, loop_kind, loop_preset, loop_path, bg_color, music_kind, music_url, music_path, focus_minutes, break_minutes, anchor, status, created_at";
const MISSING = "Hosted rooms need a database update. Run supabase/migration-23-user-cafes.sql and supabase/migration-24-cafe-backgrounds.sql.";
const nice = (m: string, fallback: string) => (/schema cache|does not exist|could not find the (table|function)|bucket/i.test(m) ? MISSING : fallback);
const ALLOWED_LOOP = /\.(mp4|webm)$/i;
const ALLOWED_AUDIO = /\.(mp3|m4a|ogg|wav)$/i;

type Supa = Awaited<ReturnType<typeof createClient>>;

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

function validateCafe(uid: string, i: CafeInput): { row: Record<string, unknown> } | { error: string } {
  const name = i.name.trim();
  if (!name) return { error: "Give your room a name." };
  if (name.length > 60) return { error: "Keep the name to 60 characters." };
  const description = i.description.trim();
  if (description.length > 200) return { error: "Keep the description to 200 characters." };
  if (!(i.focus_minutes >= 5 && i.focus_minutes <= 120)) return { error: "Focus time must be between 5 and 120 minutes." };
  if (!(i.break_minutes >= 1 && i.break_minutes <= 60)) return { error: "Break time must be between 1 and 60 minutes." };
  const mine = (p: string | null) => !!p && p.startsWith(`${uid}/`) && !p.includes("..");
  let loop_preset: SceneId | null = null, loop_path: string | null = null, bg_color: string | null = null;
  if (i.loop_kind === "preset") {
    if (!i.loop_preset || !SCENES.includes(i.loop_preset)) return { error: "Pick one of the loops." };
    loop_preset = i.loop_preset;
  } else if (i.loop_kind === "upload") {
    if (!mine(i.loop_path) || !ALLOWED_LOOP.test(i.loop_path!)) return { error: "Upload an mp4 or webm loop." };
    loop_path = i.loop_path;
  } else if (i.loop_kind === "image") {
    if (!mine(i.loop_path) || !IMAGE_EXT.test(i.loop_path!)) return { error: "Upload a JPG, PNG or WebP picture." };
    loop_path = i.loop_path;
  } else if (i.loop_kind === "color") {
    if (!i.bg_color || !HEX_COLOR.test(i.bg_color)) return { error: "Pick a background colour." };
    bg_color = i.bg_color.toLowerCase();
  } else {
    return { error: "Pick a background." };
  }
  let music_url: string | null = null, music_path: string | null = null;
  if (i.music_kind === "link") {
    if (!i.music_url || !toEmbed(i.music_url)) return { error: "Paste a Spotify, YouTube, Apple Music or SoundCloud link." };
    music_url = i.music_url.trim().slice(0, 500);
  } else if (i.music_kind === "upload") {
    if (!mine(i.music_path) || !ALLOWED_AUDIO.test(i.music_path!)) return { error: "Upload an mp3, m4a, ogg or wav track." };
    music_path = i.music_path;
  }
  return {
    row: {
      name, description, loop_kind: i.loop_kind, loop_preset, loop_path, bg_color, music_kind: i.music_kind, music_url, music_path,
      focus_minutes: Math.round(i.focus_minutes), break_minutes: Math.round(i.break_minutes),
    },
  };
}

async function removeFiles(supabase: Supa, paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => !!p);
  if (list.length) await supabase.storage.from("cafe-media").remove(list);
}

export async function createUserCafe(input: CafeInput): Promise<{ id: string } | { error: string }> {
  const { supabase, user } = await authed();
  const v = validateCafe(user.id, input);
  if ("error" in v) return v;
  const status = input.listing === "pending" ? "pending" : "unlisted";
  const { data, error } = await supabase.from("user_cafes").insert({ ...v.row, owner_id: user.id, status }).select("id").single();
  if (error) return { error: nice(error.message, "Couldn't create the room. Try again.") };
  revalidatePath("/discover");
  return { id: data.id as string };
}

export async function updateUserCafe(id: string, input: CafeInput): Promise<{ id: string } | { error: string }> {
  const { supabase, user } = await authed();
  const v = validateCafe(user.id, input);
  if ("error" in v) return v;
  const { data: old } = await supabase.from("user_cafes").select("loop_path, music_path, status").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!old) return { error: "That room no longer exists." };
  const row: Record<string, unknown> = { ...v.row };
  // Owners move between link-only and awaiting review; only an admin lists or hides a room.
  if (old.status === "unlisted" || old.status === "pending") row.status = input.listing;
  const { error } = await supabase.from("user_cafes").update(row).eq("id", id).eq("owner_id", user.id);
  if (error) return { error: nice(error.message, "Couldn't save your changes. Try again.") };
  await removeFiles(supabase, [old.loop_path !== row.loop_path ? old.loop_path : null, old.music_path !== row.music_path ? old.music_path : null]);
  revalidatePath("/discover");
  revalidatePath(`/discover/c/${id}`);
  return { id };
}

export async function deleteUserCafe(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  const { data: old } = await supabase.from("user_cafes").select("loop_path, music_path").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!old) return { error: "That room no longer exists." };
  const { error } = await supabase.from("user_cafes").delete().eq("id", id).eq("owner_id", user.id);
  if (error) return { error: nice(error.message, "Couldn't delete the room. Try again.") };
  await removeFiles(supabase, [old.loop_path, old.music_path]);
  revalidatePath("/discover");
  return {};
}

// Short-lived signed links for uploaded loops and tracks (the bucket is private).
export async function signCafeMedia(paths: (string | null)[]): Promise<(string | null)[]> {
  const { supabase } = await authed();
  return Promise.all(paths.map(async (p) => {
    if (!p) return null;
    const { data } = await supabase.storage.from("cafe-media").createSignedUrl(p, 6 * 3600);
    return data?.signedUrl ?? null;
  }));
}

async function hostsOf(supabase: Supa, rows: UserCafe[]) {
  const ids = [...new Set(rows.map((r) => r.owner_id))];
  const { data } = ids.length ? await supabase.rpc("user_cafe_hosts", { p_ids: ids }) : { data: [] };
  return new Map(((data ?? []) as Host[]).map((h) => [h.id, h]));
}

async function toCards(supabase: Supa, rows: UserCafe[]): Promise<UserCafeCard[]> {
  const [hosts, urls] = await Promise.all([hostsOf(supabase, rows), signCafeMedia(rows.map((r) => r.loop_path))]);
  return rows.map((r, i) => ({ ...r, host: hosts.get(r.owner_id) ?? null, loopUrl: urls[i] }));
}

// Listed rooms ("Hosted by students") plus the signed-in user's own rooms.
export async function loadUserCafes(): Promise<{ listed: UserCafeCard[]; mine: UserCafeCard[]; error?: string }> {
  const { supabase, user } = await authed();
  const [listedRes, mineRes] = await Promise.all([
    supabase.from("user_cafes").select(CAFE_COLS).eq("status", "public").order("created_at", { ascending: false }).limit(60),
    supabase.from("user_cafes").select(CAFE_COLS).eq("owner_id", user.id).order("created_at", { ascending: false }).limit(40),
  ]);
  const err = listedRes.error ?? mineRes.error;
  if (err) return { listed: [], mine: [], error: nice(err.message, "Couldn't load hosted rooms.") };
  const [listed, mine] = await Promise.all([toCards(supabase, (listedRes.data ?? []) as UserCafe[]), toCards(supabase, (mineRes.data ?? []) as UserCafe[])]);
  return { listed, mine };
}

export async function listPendingCafes(): Promise<{ cafes: PendingCafe[] } | { error: string }> {
  const { supabase } = await adminOnly();
  const { data, error } = await supabase.from("user_cafes").select(CAFE_COLS).eq("status", "pending").order("created_at").limit(50);
  if (error) return { error: nice(error.message, "Couldn't load rooms awaiting review.") };
  const rows = (data ?? []) as UserCafe[];
  const [hosts, loops, audio] = await Promise.all([hostsOf(supabase, rows), signCafeMedia(rows.map((r) => r.loop_path)), signCafeMedia(rows.map((r) => r.music_path))]);
  return { cafes: rows.map((cafe, i) => ({ cafe, host: hosts.get(cafe.owner_id) ?? null, loopUrl: loops[i], audioUrl: audio[i] })) };
}

export async function setCafeStatus(id: string, status: "public" | "unlisted" | "hidden"): Promise<{ error?: string }> {
  const { supabase } = await adminOnly();
  const { error } = await supabase.from("user_cafes").update({ status }).eq("id", id);
  if (error) return { error: nice(error.message, "Couldn't update the room.") };
  revalidatePath("/discover");
  revalidatePath("/discover/admin");
  return {};
}
