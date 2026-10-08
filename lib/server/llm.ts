import "server-only";
import { createClient } from "@/lib/supabase/server";
import { callChat } from "@/lib/server/aiRoute";
import { pacingStatus, poolGate, fairShareFactor, sastNow, fmtSast, type PacingStatus } from "@/lib/server/pacing";
import { AI_LIMITS, PLAN_LIMITS, getPlan, isPaidPlan, type Plan, type PlanInfo } from "@/lib/server/plans";

// Shared server-side helpers for AI calls: auth, per-user hourly token budget, usage logging,
// user-facing error messages, and the Groq JSON chat call. Server-only — never a "use server"
// module, so none of these are exposed as callable endpoints.

export const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_CHAT_MODEL = "openai/gpt-oss-120b";
export const groqHeaders = { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" };

// Unmetered — exempt from the hourly AI usage cap below.
const ADMIN_EMAILS = new Set(["zayahnabrahams1@gmail.com", "zayahnabrahams2004@gmail.com"]);
export const isUnmetered = (email?: string | null) => !!email && ADMIN_EMAILS.has(email.toLowerCase());

// Layered per-student limits live in lib/server/plans.ts (PLAN_LIMITS). AI_LIMITS is the free entry.
// Admins are exempt (isUnmetered).
export { AI_LIMITS };
export const HOURLY_TOKEN_CAP = AI_LIMITS.hour.tokens;

// Turns low-level failures into messages that say what happened and what to do next.
// Messages we throw ourselves are already user-facing and pass straight through.
export function friendlyError(e: unknown, action: string): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/Groq error 429|rate.?limit/i.test(msg)) return `Couldn't ${action}: the AI service is busy right now. Wait a minute and try again.`;
  if (/Groq error 40[13]/.test(msg)) return `Couldn't ${action}: the AI service rejected the app's API key. Ask the site admin to check GROQ_API_KEY.`;
  if (/Groq error 413|too large|context length/i.test(msg)) return `Couldn't ${action}: the content is too long for the AI. Try a shorter file or split it into parts.`;
  if (/Groq error 5\d\d/.test(msg)) return `Couldn't ${action}: the AI service is having problems. Try again in a few minutes.`;
  if (e instanceof SyntaxError || /JSON/i.test(msg)) return `Couldn't ${action}: the AI sent back an unreadable answer. Please try again.`;
  if (/fetch failed|network|ECONN|ETIMEDOUT/i.test(msg)) return `Couldn't ${action}: couldn't reach the AI service. Check your internet connection and try again.`;
  if (/violates row-level security|permission denied/i.test(msg)) return `Couldn't ${action}: you don't have permission to change this.`;
  if (/relation .* does not exist|column .* does not exist|schema cache/i.test(msg)) return `Couldn't ${action}: the database is missing a recent update. Ask the site admin to run the latest Supabase migration.`;
  if (/Not authenticated/i.test(msg)) return "Your session has expired. Please sign in again.";
  return msg || `Couldn't ${action}. Please try again.`;
}

export async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

// Rejects the request if this user has burned through their hourly AI token budget.
// Skipped entirely for the admin account.
type Db = Awaited<ReturnType<typeof createClient>>;
type UserLite = { id: string; email?: string; created_at?: string };
export type WindowName = "minute" | "hour" | "day";
export type UsageWindow = { name: WindowName; usedTokens: number; usedRequests: number; limitTokens: number; limitRequests: number; freeAtMs: number };

/** One llm_usage query covers the minute, hour and day windows (day = Africa/Johannesburg calendar day). */
export async function loadUserWindows(supabase: Db, user: UserLite, now = Date.now(), planInfo?: PlanInfo) {
  const { dayStartMs, nextMidnightMs } = sastNow(now);
  const since = Math.min(dayStartMs, now - 3600_000);
  const plan: Plan = (planInfo ?? await getPlan(supabase, user, now)).plan;
  const L = PLAN_LIMITS[plan];
  const paid = isPaidPlan(plan);
  // Paid plans do not touch the free pool, so org pacing and fair share do not apply to them.
  const [{ data }, { data: credits }, pace] = await Promise.all([
    supabase.from("llm_usage").select("tokens, created_at").eq("user_id", user.id).gte("created_at", new Date(since).toISOString()).order("created_at"),
    supabase.from("ai_credits").select("balance").eq("user_id", user.id).maybeSingle(),
    paid ? Promise.resolve(null as PacingStatus | null) : pacingStatus(supabase, now),
  ]);
  const rows = (data ?? []).map((r) => ({ t: new Date(r.created_at).getTime(), tokens: r.tokens ?? 0 }));
  const factor = pace ? fairShareFactor(pace) : 1;
  const inSetup = !!user.created_at && now - new Date(user.created_at).getTime() < L.setupDays * 86400_000;
  const dayTokens = inSetup ? L.setupDayTokens : Math.round(L.day.tokens * factor);
  const mk = (name: WindowName, from: number, len: number, lt: number, lr: number): UsageWindow => {
    const inWin = rows.filter((r) => r.t >= from);
    return { name, usedTokens: inWin.reduce((s, r) => s + r.tokens, 0), usedRequests: inWin.length, limitTokens: lt, limitRequests: lr, freeAtMs: inWin[0] ? (name === "day" ? nextMidnightMs : inWin[0].t + len) : now };
  };
  const windows = [
    mk("minute", now - 60_000, 60_000, L.minute.tokens, L.minute.requests),
    mk("hour", now - 3600_000, 3600_000, Math.round(L.hour.tokens * factor), Math.round(L.hour.requests * factor)),
    mk("day", dayStartMs, 0, dayTokens, Math.round(L.day.requests * (inSetup ? 1 : factor))),
  ];
  return { windows, credits: credits?.balance ?? 0, pace, plan };
}

const windowPct = (w: UsageWindow) => Math.min(100, Math.round(Math.max(w.usedTokens / w.limitTokens, w.usedRequests / w.limitRequests) * 100));
export const tightestWindow = (ws: UsageWindow[]) => ws.reduce((a, b) => (windowPct(b) > windowPct(a) ? b : a));
export { windowPct };

// Rejects the request when a per-student window (minute, hour, day) is used up, cheapest window first,
// naming which one and when it frees up. Admins are skipped. With opts.estimate it refuses up front when the
// job would not fit in what is left; with opts.purpose "batch" it also honours the org-wide pause.
// Bonus credits let a call through when a student window is full.
export async function enforceRateLimit(supabase: Db, user: UserLite, opts?: { estimate?: number; purpose?: "interactive" | "batch"; task?: string; plan?: PlanInfo }): Promise<Plan | undefined> {
  if (isUnmetered(user.email)) return "admin";
  const now = Date.now();
  const planInfo = opts?.plan ?? await getPlan(supabase, user, now);
  const { windows, credits, pace, plan } = await loadUserWindows(supabase, user, now, planInfo);
  // One short pointer for free students only. Pro never sees limit messages about plans.
  const nudge = plan === "free" ? " Logia Pro removes the wait." : "";
  if (pace && opts?.purpose === "batch") {
    const g = poolGate(pace, opts.estimate ?? 0, "batch", now);
    if (!g.ok && g.waitMs === Infinity) throw new Error(g.message);
  }
  const est = opts?.estimate ?? 0;
  for (const w of windows) {
    const reqFull = w.usedRequests >= w.limitRequests;
    // The minute window smooths bursts, so one big job is judged on what was already used, not its estimate.
    const tokFull = est > 0 && w.name !== "minute" ? w.usedTokens + est > w.limitTokens : w.usedTokens >= w.limitTokens;
    if (!reqFull && !tokFull) continue;
    if (credits > 0) return plan; // spent from bonus credits in record_usage()
    const secs = Math.max(5, Math.ceil((w.freeAtMs - now) / 1000));
    const when = fmtSast(w.freeAtMs);
    // Plain language only: no numbers, no mechanics. Short waits say seconds, longer ones a clock time.
    const back = w.name === "day" ? "tomorrow morning" : secs < 120 ? `in about ${secs} seconds` : `at ${when}`;
    const fits = est > 0 && w.usedTokens < w.limitTokens && !reqFull;
    if (fits) throw new Error(`There isn't enough AI time left to ${opts?.task ?? "finish that"} right now. It's back ${back}.${nudge}`);
    const span = w.name === "day" ? "today" : w.name === "hour" ? "this hour" : "just now";
    throw new Error((w.name === "day"
      ? "You've done a lot of AI work today. It's back tomorrow morning."
      : secs < 120 ? `You've done a lot of AI work ${span}. Try again in about ${secs} seconds.` : `You've done a lot of AI work ${span}. It's back at ${when}.`) + nudge);
  }
  return plan;
}

/** Pre-flight for expensive jobs: refuses up front, with a clear message, if the estimate will not fit. */
export async function checkBudget(estimatedTokens: number, purpose: "interactive" | "batch" = "batch", task?: string) {
  const { supabase, user } = await authed();
  await enforceRateLimit(supabase, user, { estimate: estimatedTokens, purpose, task });
}

// Whisper bills by audio length, not tokens; approximate from the transcript so it still counts.
export const estimateTokens = (text: string) => Math.max(200, Math.ceil(text.length / 4));

export async function logUsage(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, tokens: number) {
  if (!tokens) return;
  try {
    // record_usage() logs the tokens and spends bonus credits for anything over the hourly cap.
    const { error } = await supabase.rpc("record_usage", { used_tokens: tokens });
    if (error) await supabase.from("llm_usage").insert({ user_id: userId, tokens }); // migration 15 not run yet
  } catch { /* best-effort */ }
}

// Shared Groq chat-completions helper for structured JSON generation.
// maxTokens caps output cost — callers pass only as much as their JSON shape actually needs.
// reasoning_effort:"low" keeps gpt-oss from burning the budget on hidden reasoning tokens.
// Despite the name, this now goes through the multi-provider router (lib/server/aiRoute.ts).
export async function groqChat(system: string, user: string, maxTokens = 700, purpose: "interactive" | "batch" = "batch", task?: string) {
  const { supabase, user: authUser } = await authed();
  const plan = (await enforceRateLimit(supabase, authUser, { purpose, task, estimate: Math.ceil((system.length + user.length) / 4) + maxTokens })) ?? "free";
  const { content } = await callChat({ purpose, system, user, maxTokens, json: true, supabase, userId: authUser.id, unmetered: isUnmetered(authUser.email), plan });
  return JSON.parse(content || "{}");
}
