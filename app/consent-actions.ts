"use server";

import { createClient } from "@/lib/supabase/server";
import { TERMS_VERSION, looksLikeEmail } from "@/lib/legal";

// Records acceptance of the current terms on the signed-in user's own profile.
export async function acceptTerms(input: { age: string; guardianEmail?: string; guardianOk?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (input.age !== "18+" && input.age !== "13-17") return { ok: false, error: "Logia is for people aged 13 and older." };
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { terms_version: TERMS_VERSION, terms_accepted_at: now, age_band: input.age };
  if (input.age === "13-17") {
    const email = (input.guardianEmail ?? "").trim().slice(0, 254);
    if (!looksLikeEmail(email) || !input.guardianOk) return { ok: false, error: "A parent or guardian's email and agreement are needed." };
    row.guardian_email = email;
    row.guardian_consent_at = now;
  }
  const { error } = await supabase.from("profiles").update(row).eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save that. Please try again." };
  return { ok: true };
}
