import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/server/admin";

// Plans and their per-student AI limits. Tune the numbers here. Students never see these figures.
// Admins are unmetered (see isUnmetered in llm.ts), so the admin entry is never consulted for a limit.

export type Plan = "free" | "pro" | "admin";
type Db = Awaited<ReturnType<typeof createClient>>;

export type PlanLimits = {
  minute: { tokens: number; requests: number };
  hour: { tokens: number; requests: number };
  day: { tokens: number; requests: number };
  /** Daily token limit for a new account's first setupDays days, so onboarding never fails. */
  setupDayTokens: number;
  setupDays: number;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    minute: { tokens: 6000, requests: 8 },
    hour: { tokens: 25000, requests: 60 },
    day: { tokens: 60000, requests: 300 },
    setupDayTokens: 100000,
    setupDays: 7,
  },
  // A fair-use ceiling only: a normal student will never meet it.
  pro: {
    minute: { tokens: 20000, requests: 20 },
    hour: { tokens: 150000, requests: 200 },
    day: { tokens: 600000, requests: 1000 },
    setupDayTokens: 600000,
    setupDays: 7,
  },
  admin: {
    minute: { tokens: Infinity, requests: Infinity },
    hour: { tokens: Infinity, requests: Infinity },
    day: { tokens: Infinity, requests: Infinity },
    setupDayTokens: Infinity,
    setupDays: 7,
  },
};

/** The free entry, kept under its old name so existing imports keep working. */
export const AI_LIMITS = PLAN_LIMITS.free;

export type PlanInfo = { plan: Plan; /** ISO expiry of a paid plan, or null. */ until: string | null };

/**
 * The plan in force for this user right now. Reads the profile once; an expired pro counts as free
 * (same rule as effective_plan() in migration 35). Admin emails are always admin. If migration 35 has
 * not been run, everyone who is not an admin is free.
 */
export async function getPlan(db: Db, user: { id: string; email?: string | null }, now = Date.now()): Promise<PlanInfo> {
  if (isAdmin(user.email)) return { plan: "admin", until: null };
  try {
    const { data, error } = await db.from("profiles").select("plan, plan_until").eq("id", user.id).maybeSingle();
    if (error || !data) return { plan: "free", until: null };
    const until = data.plan_until ? new Date(data.plan_until).getTime() : null;
    if (data.plan === "pro" && until !== null && until > now) return { plan: "pro", until: new Date(until).toISOString() };
    if (data.plan === "admin") return { plan: "admin", until: null };
  } catch { /* migration 35 not run: free */ }
  return { plan: "free", until: null };
}

/** Pro and admin skip the pacing that rations the free pool and use paid providers first. */
export const isPaidPlan = (p: Plan) => p === "pro" || p === "admin";

/**
 * PAYMENT SEAM. A future payment webhook calls this when a subscription starts or renews.
 * It records the plan through set_user_plan (migration 35). That function currently requires an admin
 * session; a webhook has none, so the payments work must add a trusted path (for example a service-role
 * client or a secret-checked function) before wiring this up. Nothing calls this yet.
 */
export async function grantProFromPayment(userId: string, until: Date, source: string): Promise<{ ok: true } | { error: string }> {
  const db = await createClient();
  const { error } = await db.rpc("set_user_plan", { p_user_id: userId, p_plan: "pro", p_until: until.toISOString(), p_source: source });
  return error ? { error: error.message } : { ok: true };
}
