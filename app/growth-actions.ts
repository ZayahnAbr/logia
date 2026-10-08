"use server";

import { createClient } from "@/lib/supabase/server";
import { getPlan } from "@/lib/server/plans";
import { AI_LIMITS, isUnmetered, loadUserWindows, tightestWindow, windowPct } from "@/lib/server/llm";

const MISSING = "This needs a database update. Run supabase/migration-15-growth.sql.";
const missing = (m?: string) => !!m && /waitlist|ai_credits|referral|function .* does not exist|schema cache/i.test(m);

export async function joinWaitlist(email: string) {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean) || clean.length > 254) return { error: "Enter a valid email address, like name@example.com." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("waitlist").insert({ email: clean, user_id: user?.id ?? null });
  if (error && !/duplicate|unique/i.test(error.message)) return { error: missing(error.message) ? MISSING : "Couldn't add you to the waitlist. Try again." };
  return { ok: true }; // already on the list counts as success
}

export async function getAiAllowance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (isUnmetered(user.email)) return { unlimited: true as const };
  const info = await getPlan(supabase, user);
  // Pro students see no meter and no limit messages, only a plain "Pro" line with the renewal date.
  if (info.plan === "pro") return { unlimited: false as const, pro: true as const, until: info.until };
  const { windows, credits } = await loadUserWindows(supabase, user, Date.now(), info);
  // The meter shows the tightest of the minute, hour and day windows and names it.
  const w = tightestWindow(windows);
  const pct = windowPct(w);
  const refillAt = pct > 0 && w.usedTokens + w.usedRequests > 0 ? new Date(w.freeAtMs).toISOString() : null;
  return { unlimited: false as const, pro: false as const, pct, window: w.name, refillAt, bonusHours: Math.round((credits / AI_LIMITS.hour.tokens) * 2) / 2 };
}

export async function getInviteInfo() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { signedIn: false as const };
  const [code, friends, credits] = await Promise.all([
    supabase.rpc("get_my_referral_code"),
    supabase.from("referrals").select("referred_id", { count: "exact", head: true }).eq("referrer_id", user.id),
    supabase.from("ai_credits").select("balance").eq("user_id", user.id).maybeSingle(),
  ]);
  if (code.error) return { signedIn: true as const, error: missing(code.error.message) ? MISSING : code.error.message };
  return { signedIn: true as const, code: code.data as string, friends: friends.count ?? 0, credits: credits.data?.balance ?? 0 };
}

const CLAIM_MESSAGES: Record<string, string> = {
  ok: "Invite accepted. You and your friend each got bonus AI time.",
  invalid: "That invite link isn't valid any more.",
  own_code: "That's your own invite link. Share it with a friend instead.",
  already_claimed: "You've already used an invite link.",
  too_old: "Invite links only work for accounts made in the last 14 days.",
  not_signed_in: "Sign in to accept the invite.",
};

export async function claimReferral(code: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_referral", { invite_code: code.slice(0, 32) });
  if (error) return { ok: false, message: missing(error.message) ? MISSING : "Couldn't accept the invite. Try again later." };
  return { ok: data === "ok", message: CLAIM_MESSAGES[data as string] ?? "Couldn't accept the invite." };
}
