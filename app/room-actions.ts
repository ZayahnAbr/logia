"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasBlockedWord, isBlockedError } from "@/lib/moderation";

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

const MISSING = "Study rooms aren't set up yet. Run supabase/migration-12-study-rooms.sql.";
const friendly = (msg?: string) => (msg && /study_rooms|room_messages|does not exist|schema cache/.test(msg) ? MISSING : msg ?? "Something went wrong. Try again.");

export async function createRoom(spaceId: string, input: { title: string; goal: string; silent: boolean; chat: boolean; voice: boolean; minutes: number }) {
  const { supabase, user } = await authed();
  if (!user) return { error: "Sign in again to continue." };
  const title = input.title.trim().slice(0, 80);
  if (!title) return { error: "Give the room a name." };
  if (hasBlockedWord(`${title} ${input.goal}`)) return { error: "That name or goal can't be used. Please change it." };
  const minutes = Math.min(180, Math.max(5, Math.round(input.minutes) || 50));
  const base = {
    space_id: spaceId, title, goal: input.goal.trim().slice(0, 300) || null,
    silent: input.silent, chat_enabled: input.chat, timer_minutes: minutes, created_by: user.id,
  };
  let { data, error } = await supabase.from("study_rooms").insert({ ...base, voice_enabled: input.voice }).select("id").single();
  if (error && /voice_enabled/.test(error.message)) ({ data, error } = await supabase.from("study_rooms").insert(base).select("id").single());
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/spaces/${spaceId}/rooms`);
  return { id: data!.id as string };
}

export async function setRoomTimer(roomId: string, running: boolean) {
  const { supabase, user } = await authed();
  if (!user) return { error: "Sign in again to continue." };
  const { error } = await supabase.from("study_rooms")
    .update({ timer_started_at: running ? new Date().toISOString() : null }).eq("id", roomId);
  return error ? { error: friendly(error.message) } : { ok: true };
}

export async function endRoom(spaceId: string, roomId: string) {
  const { supabase, user } = await authed();
  if (!user) return { error: "Sign in again to continue." };
  const { error } = await supabase.from("study_rooms")
    .update({ ended_at: new Date().toISOString(), timer_started_at: null })
    .eq("id", roomId).eq("created_by", user.id);
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/spaces/${spaceId}/rooms`);
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sendRoomMessage(roomId: string, author: { name: string; color: string | null; icon: string | null }, body: string, mentions: string[] = []) {
  const { supabase, user } = await authed();
  if (!user) return { error: "Sign in again to continue." };
  const text = body.trim().slice(0, 1000);
  if (!text) return { error: "Message is empty." };
  if (hasBlockedWord(text)) return { error: "That message wasn't sent.", blocked: true as const };
  const row = { room_id: roomId, user_id: user.id, author: author.name.slice(0, 60), body: text };
  const ids = [...new Set(mentions.filter((m) => UUID.test(m) && m !== user.id))].slice(0, 10);
  let { data, error } = await supabase.from("room_messages").insert({ ...row, author_color: author.color, author_icon: author.icon, mentions: ids }).select("id").single();
  // Older databases: retry without the newer columns (avatar: migration 13, mentions: migration 18).
  if (error && /mentions/.test(error.message)) ({ data, error } = await supabase.from("room_messages").insert({ ...row, author_color: author.color, author_icon: author.icon }).select("id").single());
  if (error && /author_(color|icon)/.test(error.message)) ({ data, error } = await supabase.from("room_messages").insert(row).select("id").single());
  if (error && isBlockedError(error.message)) return { error: "That message wasn't sent.", blocked: true as const };
  return error ? { error: friendly(error.message) } : { ok: true, id: data?.id as string, mentions: ids };
}
