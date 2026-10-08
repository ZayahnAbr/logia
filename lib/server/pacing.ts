import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { PROVIDERS } from "@/lib/server/providers";

// Spreads the pooled daily token budget across the day so the morning cannot burn what evening
// students need. Day and hours are Africa/Johannesburg (UTC+2, no daylight saving).
// Spend is stored per hour by ai_pace_add() (migration 34). All numbers here are easy to tune.

type Db = Awaited<ReturnType<typeof createClient>>;

export const PACING = {
  /** Relative demand per hour of day (SAST): quiet 00-06, moderate 07-16, peak 17-23. */
  weightQuiet: 1,
  weightModerate: 3,
  weightPeak: 5,
  /** Share of the daily budget that can only be spent from reserveFromHour onward. */
  reserveFraction: 0.15,
  reserveFromHour: 17,
  /** An overspending hour may borrow up to this fraction of the next hour's share. */
  borrowFraction: 0.5,
  /** Below this remaining fraction of the day's budget, per-user hour and day limits are halved. */
  fairShareBelow: 0.3,
  /** Below this remaining fraction, only interactive calls are allowed. */
  batchPausedBelow: 0.1,
};

const hourWeight = (h: number) => (h <= 6 ? PACING.weightQuiet : h <= 16 ? PACING.weightModerate : PACING.weightPeak);
const SAST_MS = 2 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

export const sastNow = (now = Date.now()) => {
  const local = now + SAST_MS;
  const dayStartLocal = Math.floor(local / (24 * HOUR_MS)) * 24 * HOUR_MS;
  return { hour: Math.floor((local - dayStartLocal) / HOUR_MS), dayStartMs: dayStartLocal - SAST_MS, nextMidnightMs: dayStartLocal - SAST_MS + 24 * HOUR_MS };
};
export const fmtSast = (ms: number) => new Date(ms).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

/** Pooled daily token budget: the sum of known daily token limits of the enabled providers. 0 = unknown, pacing off. */
// Entries sharing a slot bucket (same account) count once.
export const poolBudget = () => {
  const seen = new Set<string>();
  return PROVIDERS.filter((p) => p.enabled && p.tier === "free" && p.limits.tpd > 0 && !seen.has(p.slotKey ?? p.id) && !!seen.add(p.slotKey ?? p.id)).reduce((s, p) => s + p.limits.tpd, 0);
};

/** Per-hour share of the budget before the reserve is released (hours below reserveFromHour never see it). */
export function hourShares(budget: number): number[] {
  const base = budget * (1 - PACING.reserveFraction);
  const reserve = budget * PACING.reserveFraction;
  const all = Array.from({ length: 24 }, (_, h) => hourWeight(h));
  const sumAll = all.reduce((a, b) => a + b, 0);
  const sumLate = all.slice(PACING.reserveFromHour).reduce((a, b) => a + b, 0);
  return all.map((w, h) => (base * w) / sumAll + (h >= PACING.reserveFromHour ? (reserve * w) / sumLate : 0));
}

export type PacingStatus = {
  enabled: boolean;
  /** Pooled daily budget and spend, in tokens (internal; never show raw numbers to students). */
  dailyBudget: number;
  spentToday: number;
  remainingFraction: number;
  hour: number;
  hourShare: number;
  hourSpend: number;
  /** Cumulative allowance up to the end of this hour, including carry-over from earlier hours. */
  allowedSoFar: number;
  reserve: { total: number; released: boolean; remaining: number };
  /** ISO time the day's budget runs out at the last three hours' rate, or null if it will not. */
  projectedExhaustionAt: string | null;
  resetsAt: string;
  hourly: { hour: number; share: number; spent: number; requests: number }[];
};

export async function pacingStatus(db: Db, now = Date.now()): Promise<PacingStatus> {
  const budget = poolBudget();
  const { hour, nextMidnightMs } = sastNow(now);
  const spent = new Array<number>(24).fill(0);
  const reqs = new Array<number>(24).fill(0);
  try {
    const { data } = await db.rpc("ai_pace_status");
    for (const r of (data ?? []) as { hour: number; tokens: number; requests: number }[]) { spent[r.hour] = r.tokens; reqs[r.hour] = r.requests; }
  } catch { /* migration 34 not run: treated as no spend */ }
  const shares = budget > 0 ? hourShares(budget) : new Array<number>(24).fill(0);
  const total = spent.reduce((a, b) => a + b, 0);
  const cum = shares.slice(0, hour + 1).reduce((a, b) => a + b, 0);
  const reserveTotal = budget * PACING.reserveFraction;
  const released = hour >= PACING.reserveFromHour;
  const reserveSpent = Math.max(0, total - budget * (1 - PACING.reserveFraction));
  const recent = spent.slice(Math.max(0, hour - 2), hour + 1).reduce((a, b) => a + b, 0);
  const elapsedH = Math.min(3, hour + ((now + SAST_MS) % HOUR_MS) / HOUR_MS) || 1;
  const rate = recent / Math.max(0.25, elapsedH); // tokens per hour
  let projected: string | null = null;
  if (budget > 0 && total >= budget) projected = new Date(now).toISOString();
  else if (budget > 0 && rate > 0) {
    const at = now + ((budget - total) / rate) * HOUR_MS;
    if (at < nextMidnightMs) projected = new Date(at).toISOString();
  }
  return {
    enabled: budget > 0, dailyBudget: budget, spentToday: total, remainingFraction: budget > 0 ? Math.max(0, (budget - total) / budget) : 1,
    hour, hourShare: Math.round(shares[hour]), hourSpend: spent[hour], allowedSoFar: Math.round(cum),
    reserve: { total: Math.round(reserveTotal), released, remaining: Math.round(released ? Math.max(0, reserveTotal - reserveSpent) : reserveTotal) },
    projectedExhaustionAt: projected, resetsAt: new Date(nextMidnightMs).toISOString(),
    hourly: shares.map((s, h) => ({ hour: h, share: Math.round(s), spent: spent[h], requests: reqs[h] })),
  };
}

/** Fair-share multiplier for per-user hour and day limits. */
export const fairShareFactor = (s: PacingStatus) => (s.enabled && s.remainingFraction < PACING.fairShareBelow ? 0.5 : 1);

export const BATCH_PAUSED_MESSAGE = "Big jobs like marking papers, reading course outlines and transcribing lectures are paused until tomorrow morning. Notes, flashcards and questions still work.";

export type GateResult = { ok: true } | { ok: false; message: string; waitMs: number };

/** Org-level gate: batch pause, hourly pacing and the daily ceiling. Interactive calls get priority. */
export function poolGate(s: PacingStatus, estimate: number, purpose: "interactive" | "batch", now = Date.now()): GateResult {
  if (!s.enabled) return { ok: true };
  if (purpose === "batch" && s.remainingFraction < PACING.batchPausedBelow) return { ok: false, message: BATCH_PAUSED_MESSAGE, waitMs: Infinity };
  const hardCap = s.hour >= PACING.reserveFromHour ? s.dailyBudget : s.dailyBudget * (1 - PACING.reserveFraction);
  if (s.spentToday >= s.dailyBudget) {
    return { ok: false, message: "Logia's AI is resting for today and is back tomorrow morning. Your notes and files still work.", waitMs: Infinity };
  }
  const nextShare = s.hour < 23 ? hourShares(s.dailyBudget)[s.hour + 1] : 0;
  const frac = purpose === "interactive" ? 1 : PACING.borrowFraction;
  const allowed = Math.min(hardCap, s.allowedSoFar + nextShare * frac);
  if (s.spentToday + estimate > allowed) {
    const nextHourMs = Math.floor((now + SAST_MS) / HOUR_MS) * HOUR_MS - SAST_MS + HOUR_MS;
    return { ok: false, message: "Logia's AI is busy right now. Try again in a few minutes.", waitMs: Math.max(0, nextHourMs - now) };
  }
  return { ok: true };
}

export async function recordSpend(db: Db, tokens: number) {
  try { await db.rpc("ai_pace_add", { p_tokens: tokens }); } catch { /* best-effort */ }
}
