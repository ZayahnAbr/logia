"use server";

import { createClient } from "@/lib/supabase/server";
import { AVATAR_COLORS, AVATAR_ICONS } from "@/components/Avatar";

export async function updateAvatar(color: string, icon: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to continue." };
  if (!AVATAR_COLORS.some((c) => c.id === color) || !AVATAR_ICONS.some((i) => i.id === icon)) return { error: "Pick a colour and a symbol." };
  const { error } = await supabase.from("profiles").update({ avatar_color: color, avatar_icon: icon }).eq("id", user.id);
  if (error) return { error: /avatar_/.test(error.message) ? "Avatars need a database update. Run supabase/migration-13-avatars-voice.sql." : error.message };
  return { ok: true };
}
