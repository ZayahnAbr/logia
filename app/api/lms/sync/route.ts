import { NextResponse, type NextRequest } from "next/server";

// Receives deadlines from the "Logia School Sync" browser extension (Brightspace, Canvas, Moodle, Blackboard).
// Auth is a Bearer connection code (only its sha256 hash is stored). There is no service-role key in this
// app, so the write goes through the SECURITY DEFINER function lms_sync() from migration 29, which finds the
// user from the code. Nothing here ever sees a school password, cookie or page.
// Item links must be https and on the school origin the extension names (fixed by the connection's first sync).

export const runtime = "nodejs";

const MAX_ITEMS = 500;
const PLATFORMS = ["brightspace", "canvas", "moodle", "blackboard"];
const MAX_BODY = 600_000; // bytes of JSON text
const TYPES = ["assignment", "quiz", "discussion", "checklist", "event", "other"] as const;

type Clean = { sourceId: string; title: string; course: string; courseCode: string; type: string; dueAt: string | null; url: string; completed: boolean };

function corsHeaders(origin: string | null): Record<string, string> {
  // Only browser extensions may call this cross-origin. The Authorization header carries a secret code, so
  // we never reflect ordinary web origins.
  const ok = !!origin && /^(chrome-extension|moz-extension|edge-extension):\/\/[a-z0-9-]+$/i.test(origin);
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin as string } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return NextResponse.json(body, { status, headers: { ...corsHeaders(origin), "Cache-Control": "no-store" } });
}

/** A school origin like https://learn.school.edu (https only, no path). Null if invalid. */
function schoolOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.origin.toLowerCase();
  } catch { return null; }
}

/** "" for no link, the link if https and on the school origin, null to reject the item. */
function allowedUrl(raw: unknown, school: string | null): string | null {
  if (raw == null || raw === "") return "";
  if (typeof raw !== "string" || raw.length > 600 || !school) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.origin.toLowerCase() !== school) return null;
    return u.toString();
  } catch { return null; }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanItem(raw: unknown, school: string | null): Clean | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sourceId = str(r.sourceId, 200);
  const title = str(r.title, 300);
  if (!sourceId || !title) return null;
  let dueAt: string | null = null;
  if (typeof r.dueAt === "string" && r.dueAt) {
    const d = new Date(r.dueAt);
    if (Number.isNaN(d.getTime())) return null;
    dueAt = d.toISOString();
  }
  const url = allowedUrl(r.url, school);
  if (url === null) return null;
  const type = TYPES.includes(r.type as (typeof TYPES)[number]) ? (r.type as string) : "other";
  return { sourceId, title, course: str(r.course, 200), courseCode: str(r.courseCode, 40), type, dueAt, url, completed: r.completed === true };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(auth);
  if (!m) return json({ ok: false, error: "Missing or malformed connection code." }, 401, origin);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return json({ ok: false, error: "Too much data in one sync." }, 413, origin);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ ok: false, error: "Too much data in one sync." }, 413, origin);

  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ ok: false, error: "That wasn't valid JSON." }, 400, origin); }
  const b = body as { items?: unknown; windowStart?: unknown; windowEnd?: unknown; complete?: unknown; origin?: unknown; platform?: unknown } | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.items)) return json({ ok: false, error: "Expected an items list." }, 400, origin);
  if (b.items.length > MAX_ITEMS) return json({ ok: false, error: `At most ${MAX_ITEMS} items per sync.` }, 413, origin);

  const platform = typeof b.platform === "string" ? b.platform : null;
  if (b.platform != null && !PLATFORMS.includes(platform as string)) return json({ ok: false, error: "That learning platform isn't supported yet. Brightspace, Canvas and Moodle work; Blackboard is experimental." }, 400, origin);
  if (platform === null && b.items.length > 0) return json({ ok: false, error: "Say which learning platform these items came from." }, 400, origin);
  const school = schoolOrigin(b.origin);
  const items = b.items.map((x) => cleanItem(x, school)).filter((x): x is Clean => x !== null);

  // Only a sync that carries every item in its window may mark missing items as removed.
  let windowStart: string | null = null, windowEnd: string | null = null;
  if (b.complete === true && typeof b.windowStart === "string" && typeof b.windowEnd === "string") {
    const s = new Date(b.windowStart), e = new Date(b.windowEnd);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e > s) { windowStart = s.toISOString(); windowEnd = e.toISOString(); }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return json({ ok: false, error: "Logia isn't configured for syncing." }, 503, origin);

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/lms_sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_token: m[1], p_items: items, p_window_start: windowStart, p_window_end: windowEnd, p_origin: school, p_platform: platform }),
      cache: "no-store",
    });
  } catch {
    return json({ ok: false, error: "Couldn't reach the database. Try again." }, 502, origin);
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    if (/invalid_token/.test(err.message ?? "")) return json({ ok: false, error: "That connection code isn't valid any more. Make a new one in Logia settings." }, 401, origin);
    if (/platform_mismatch/.test(err.message ?? "")) return json({ ok: false, error: "This connection code is already used for a different learning platform. Make a new code in Logia settings." }, 409, origin);
    if (res.status === 404 || /lms_sync|schema cache|does not exist/i.test(err.message ?? "")) return json({ ok: false, error: "Logia needs a database update (migration 29) before syncing works." }, 503, origin);
    return json({ ok: false, error: "Couldn't save the sync. Try again." }, 500, origin);
  }
  const out = (await res.json().catch(() => ({}))) as { count?: number };
  return json({ ok: true, count: typeof out.count === "number" ? out.count : items.length }, 200, origin);
}
