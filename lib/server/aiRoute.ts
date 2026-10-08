import "server-only";
import { createClient } from "@/lib/supabase/server";
import { authed, logUsage, estimateTokens } from "@/lib/server/llm";
import { pacingStatus, poolGate, recordSpend } from "@/lib/server/pacing";
import { getPlan, isPaidPlan, type Plan } from "@/lib/server/plans";
import { PROVIDERS, providerKey, slotOf, type Capability, type Provider } from "@/lib/server/providers";

// Multi-provider router for chat, vision and audio. Picks a provider that is enabled, has the capability
// and has headroom (reserved atomically through the take_ai_slot database function, migration 34),
// fails over on 429 / 5xx, and reports real usage back so the shared counters stay accurate.
// Providers that belong to one account share a slot bucket through slotKey (see providers.ts).
// Per-student checks (enforceRateLimit / checkBudget) are the caller's job and run once before these.

export type Purpose = "interactive" | "batch";
type Msg = { role: "system" | "user" | "assistant"; content: string };
type Db = Awaited<ReturnType<typeof createClient>>;
type Served = { provider: string; tokens: number; tier: "free" | "paid" };
type Caller = { supabase?: Db; userId?: string; unmetered?: boolean; plan?: Plan };

export const BUSY_MESSAGE = "Logia's AI is busy right now. Try again in a few minutes.";

const MAX_RETRY_AFTER_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reserves one request on a provider's slot bucket. Fails open (ok) if the table or function is not installed yet. */
export async function takeSlot(db: Db, p: Provider, estTokens: number): Promise<{ ok: boolean; retryMs: number; reason?: string }> {
  try {
    const { data, error } = await db.rpc("take_ai_slot", {
      p_provider: slotOf(p), p_est_tokens: estTokens, p_rpm: p.limits.rpm, p_tpm: p.limits.tpm, p_tpd: p.limits.tpd, p_rpd: p.limits.rpd,
    });
    if (error || !data) return { ok: true, retryMs: 0 }; // migration 34 not run yet: do not block AI
    const d = data as { ok: boolean; retry_ms?: number; reason?: string };
    return { ok: !!d.ok, retryMs: d.retry_ms ?? 0, reason: d.reason };
  } catch {
    return { ok: true, retryMs: 0 };
  }
}

export async function reportActual(db: Db, p: Provider, estTokens: number, actualTokens: number) {
  const delta = actualTokens - estTokens;
  if (!delta) return;
  try { await db.rpc("record_ai_actual", { p_provider: slotOf(p), p_delta_tokens: delta }); } catch { /* best-effort */ }
}

// Interactive prefers high requests-per-minute; batch prefers a big daily token pool.
// A limit of 0 is unknown, so it ranks in the middle.
function rank(list: Provider[], purpose: Purpose) {
  const score = (p: Provider) => purpose === "interactive" ? (p.limits.rpm || 20) : (p.limits.tpd || 500000);
  return [...list].sort((a, b) => score(b) - score(a) || a.priority - b.priority);
}

/** Resolves the db, user and plan, skipping lookups the caller already did. */
async function resolveCaller(opts: Caller): Promise<{ db: Db; uid: string; plan: Plan; paid: boolean }> {
  let db = opts.supabase, uid = opts.userId;
  let email: string | undefined;
  if (!db || !uid) { const a = await authed(); db = a.supabase; uid = a.user.id; email = a.user.email; }
  const plan: Plan = opts.plan ?? (opts.unmetered ? "admin" : (await getPlan(db, { id: uid, email })).plan);
  return { db, uid, plan, paid: isPaidPlan(plan) };
}

/** Org-level pacing and fair share (admins and paid plans are exempt). A tight hour waits only if it frees within seconds. */
async function paceGate(db: Db, est: number, purpose: Purpose, exempt: boolean) {
  if (exempt) return;
  let gate = poolGate(await pacingStatus(db), est, purpose);
  if (!gate.ok && gate.waitMs <= 4000) { await sleep(gate.waitMs + 200); gate = poolGate(await pacingStatus(db), est, purpose); }
  if (!gate.ok) throw new Error(gate.message);
}

/** Free students only use the free pool. Pro and admin try paid providers first, then fall back to free ones. */
function candidatesFor(model: "chat" | "vision" | "audio", need: Capability[], purpose: Purpose, paid: boolean) {
  const usable = PROVIDERS.filter((p) => p.enabled && p.models[model] && need.every((c) => p.capabilities.includes(c)));
  // Vision and audio quality differs a lot between models, so they follow the priority order in providers.ts
  // (a weaker model is only a fallback) instead of the speed-based chat ranking.
  const order = (list: Provider[]) => model === "chat" ? rank(list, purpose) : [...list].sort((a, b) => a.priority - b.priority);
  return paid
    ? [...order(usable.filter((p) => p.tier === "paid")), ...order(usable.filter((p) => p.tier === "free"))]
    : order(usable.filter((p) => p.tier === "free"));
}

/** Sends once; on 429 / 5xx honours a short Retry-After and sends one more time. Null means unreachable. */
async function sendWithRetry(p: Provider, send: () => Promise<Response>): Promise<Response | null> {
  try {
    let res = await send();
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
      if (waitMs > 0 && waitMs <= MAX_RETRY_AFTER_MS) { await sleep(waitMs); res = await send(); }
    }
    return res;
  } catch (e) {
    console.warn(`[ai] ${p.id} unreachable`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Counters, pacing and per-student usage after a successful call. */
async function settle(db: Db, uid: string, p: Provider, est: number, tokens: number) {
  await reportActual(db, p, est, tokens);
  if (p.tier === "free") await recordSpend(db, tokens); // paid calls do not draw on the free pool's pacing
  await logUsage(db, uid, tokens);
}

export async function callChat(opts: {
  purpose: Purpose;
  system?: string;
  user?: string;
  messages?: Msg[];
  maxTokens: number;
  json?: boolean;
  temperature?: number;
  /** Pass when the caller already has them, to skip a second auth lookup. */
  supabase?: Db;
  userId?: string;
  /** Admin accounts skip org pacing. */
  unmetered?: boolean;
  /** The caller's plan when known; otherwise it is looked up. Pro and admin use paid providers first and skip free-pool pacing. */
  plan?: Plan;
}): Promise<{ content: string; provider: string; tokens: number; tier: "free" | "paid" }> {
  const { db, uid, plan, paid } = await resolveCaller(opts);

  const messages: Msg[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    ...(opts.messages ?? []),
    ...(opts.user ? [{ role: "user" as const, content: opts.user }] : []),
  ];
  const est = Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4) + opts.maxTokens;

  await paceGate(db, est, opts.purpose, !!opts.unmetered || paid);

  const candidates = candidatesFor("chat", opts.json ? ["chat", "json"] : ["chat"], opts.purpose, paid);

  for (const p of candidates) {
    const slot = await takeSlot(db, p, est);
    if (!slot.ok) { console.info(`[ai] ${p.id} skipped (${slot.reason ?? "no headroom"})`); continue; }

    const body = JSON.stringify({
      model: p.models.chat, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens, ...(p.chatExtras ?? {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages,
    });
    const res = await sendWithRetry(p, () => fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${providerKey(p)}`, "Content-Type": "application/json" }, body,
    }));
    if (!res) continue;
    if (!res.ok) { console.warn(`[ai] ${p.id} failed with ${res.status}`); continue; }

    let data: { usage?: { total_tokens?: number }; choices?: { message?: { content?: string } }[] };
    try { data = await res.json(); } catch { continue; }
    const tokens = data.usage?.total_tokens ?? est;
    console.info(`[ai] ${opts.purpose} served by ${p.id} (${p.tier} tier, ${plan} plan)`);
    await settle(db, uid, p, est, tokens);
    return { content: data.choices?.[0]?.message?.content ?? "", provider: p.id, tokens, tier: p.tier };
  }
  throw new Error(BUSY_MESSAGE);
}

/** Image + text request (OpenAI-compatible chat/completions with image_url parts). Returns the model's text. */
export async function callVision(opts: {
  purpose: Purpose;
  system?: string;
  imageDataUrls: string[];
  text: string;
  maxTokens: number;
  json?: boolean;
  temperature?: number;
  /** What the student was doing, for logs only. The caller has already run enforceRateLimit. */
  task?: string;
} & Caller): Promise<{ content: string } & Served> {
  const { db, uid, plan, paid } = await resolveCaller(opts);

  const est = Math.ceil(((opts.system?.length ?? 0) + opts.text.length) / 4) + 500 * opts.imageDataUrls.length + opts.maxTokens;
  await paceGate(db, est, opts.purpose, !!opts.unmetered || paid);

  const candidates = candidatesFor("vision", opts.json ? ["vision", "json"] : ["vision"], opts.purpose, paid);
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: [{ type: "text", text: opts.text }, ...opts.imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } }))] },
  ];

  for (const p of candidates) {
    const slot = await takeSlot(db, p, est);
    if (!slot.ok) { console.info(`[ai] ${p.id} skipped for vision (${slot.reason ?? "no headroom"})`); continue; }

    const body = JSON.stringify({
      model: p.models.vision, temperature: opts.temperature ?? 0, max_tokens: opts.maxTokens, ...(p.visionExtras ?? {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages,
    });
    const res = await sendWithRetry(p, () => fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${providerKey(p)}`, "Content-Type": "application/json" }, body,
    }));
    if (!res) continue;
    if (!res.ok) { console.warn(`[ai] ${p.id} vision failed with ${res.status}`); continue; }

    let data: { usage?: { total_tokens?: number }; choices?: { message?: { content?: string } }[] };
    try { data = await res.json(); } catch { continue; }
    const tokens = data.usage?.total_tokens ?? est;
    console.info(`[ai] vision${opts.task ? ` (${opts.task})` : ""} served by ${p.id} (${p.tier} tier, ${plan} plan)`);
    await settle(db, uid, p, est, tokens);
    const content = String(data.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { content, provider: p.id, tokens, tier: p.tier };
  }
  throw new Error(BUSY_MESSAGE);
}

/** Speech to text. Only Groq Whisper exists today, so this is mostly slot accounting, plan-aware key choice and shared errors. */
export async function callAudio(opts: {
  file: Blob;
  filename?: string;
  purpose?: Purpose;
  /** What the student was doing, for logs only. The caller has already run enforceRateLimit. */
  task?: string;
} & Caller): Promise<{ text: string } & Served> {
  const { db, uid, plan, paid } = await resolveCaller(opts);
  const purpose = opts.purpose ?? "batch";
  const est = 200; // audio length is unknown; real usage is estimated from the transcript below
  await paceGate(db, est, purpose, !!opts.unmetered || paid);

  for (const p of candidatesFor("audio", ["audio"], purpose, paid)) {
    const slot = await takeSlot(db, p, est);
    if (!slot.ok) { console.info(`[ai] ${p.id} skipped for audio (${slot.reason ?? "no headroom"})`); continue; }

    const res = await sendWithRetry(p, () => {
      const form = new FormData();
      form.append("file", opts.file, opts.filename || "audio");
      form.append("model", p.models.audio as string);
      form.append("response_format", "text");
      return fetch(`${p.baseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${providerKey(p)}` }, body: form });
    });
    if (!res) continue;
    if (!res.ok) { console.warn(`[ai] ${p.id} audio failed with ${res.status}`); continue; }

    let text: string;
    try { text = await res.text(); } catch { continue; }
    const tokens = Math.max(est, estimateTokens(text));
    console.info(`[ai] audio${opts.task ? ` (${opts.task})` : ""} served by ${p.id} (${p.tier} tier, ${plan} plan)`);
    await settle(db, uid, p, est, tokens);
    return { text, provider: p.id, tokens, tier: p.tier };
  }
  throw new Error(BUSY_MESSAGE);
}
