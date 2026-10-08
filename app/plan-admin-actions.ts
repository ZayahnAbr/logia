"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/server/admin";

// Admin-only plan tool. Both database functions (migration 35) re-check the admin on their side.

export type PlanLookup = { userId: string; email: string; plan: "free" | "pro" | "admin"; until: string | null; source: string | null; active: boolean };

const MISSING = "This needs a database update. Run supabase/migration-35-plans.sql.";
const missing = (m?: string) => !!m && /admin_find_user|set_user_plan|plan_until|schema cache|does not exist/i.test(m);

async function adminDb() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) return null;
  return supabase;
}

export async function lookupPlan(email: string): Promise<{ user: PlanLookup } | { error: string }> {
  const db = await adminDb();
  if (!db) return { error: "Only admins can do this." };
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { error: "Enter a valid email address." };
  const { data, error } = await db.rpc("admin_find_user", { p_email: clean });
  if (error) return { error: missing(error.message) ? MISSING : "Couldn't look that user up." };
  const r = (data as { user_id: string; email: string; plan: PlanLookup["plan"]; plan_until: string | null; plan_source: string | null }[] | null)?.[0];
  if (!r) return { error: "No account with that email." };
  const active = r.plan === "admin" || (r.plan === "pro" && !!r.plan_until && new Date(r.plan_until).getTime() > Date.now());
  return { user: { userId: r.user_id, email: r.email, plan: r.plan, until: r.plan_until, source: r.plan_source, active } };
}

/** Grants Pro until the given date (inclusive of that day, SAST end of day), or revokes it back to free. */
export async function setPlan(userId: string, action: "grant" | "revoke", untilDate?: string): Promise<{ ok: true } | { error: string }> {
  const db = await adminDb();
  if (!db) return { error: "Only admins can do this." };
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Unknown user." };
  let until: string | null = null;
  if (action === "grant") {
    if (!untilDate || !/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) return { error: "Choose the date Pro should end." };
    const t = new Date(`${untilDate}T23:59:59+02:00`);
    if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return { error: "The end date must be in the future." };
    if (t.getTime() > Date.now() + 3 * 366 * 86400_000) return { error: "That is more than three years away. Pick a nearer date." };
    until = t.toISOString();
  }
  const { error } = await db.rpc("set_user_plan", { p_user_id: userId, p_plan: action === "grant" ? "pro" : "free", p_until: until, p_source: action === "grant" ? "manual" : null });
  if (error) return { error: missing(error.message) ? MISSING : error.message };
  return { ok: true };
}
