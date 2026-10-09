"use server";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { COLOR_KEYS, MAX_TEXT, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_WIDGETS_PER_SPACE, WIDGET_BUCKET, MAX_WIDGET_BYTES, STICKER_MIN_W, STICKER_MAX_W, STICKER_MAX_Y, type StickerPos, type GifData, type GifResult, type ImageData, type TextData, type StickyData, STICKY_COLOR_IDS, STICKY_MAX_TEXT } from "@/lib/customWidgets";

const MISSING = "Custom widgets need a database update. Run supabase/migration-25-space-widgets.sql.";
const nice = (m: string, fallback: string) => (/schema cache|does not exist|could not find the (table|function)|bucket/i.test(m) ? MISSING : fallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

// GIPHY: the API key stays on the server.
type GiphyImg = { url?: string; width?: string; height?: string };
type GiphyItem = { id: string; title?: string; rating?: string; images?: Record<string, GiphyImg> };
const giphyHost = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)giphy\.com$/i.test(x.hostname); } catch { return false; } };

export async function searchGiphy(query: string, kind: "gifs" | "stickers"): Promise<{ results: GifResult[]; error?: string; notConfigured?: boolean }> {
  try { await authed(); } catch { return { results: [], error: "Please sign in again." }; }
  const key = process.env.GIPHY_API_KEY;
  if (!key) return { results: [], notConfigured: true };
  const q = clean(query, 50);
  const base = `https://api.giphy.com/v1/${kind === "stickers" ? "stickers" : "gifs"}`;
  const params = new URLSearchParams({ api_key: key, limit: "24", rating: "g" });
  if (q) params.set("q", q);
  try {
    const res = await fetch(`${base}/${q ? "search" : "trending"}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { results: [], error: res.status === 401 || res.status === 403 ? "GIPHY rejected the API key." : "GIPHY is not responding right now. Try again soon." };
    const json = (await res.json()) as { data?: GiphyItem[] };
    const results = (json.data ?? []).flatMap((g) => {
      const img = g.images?.fixed_width_small ?? g.images?.fixed_width;
      if (!img?.url || !giphyHost(img.url) || (g.rating && g.rating !== "g")) return [];
      return [{ id: g.id, title: clean(g.title, 120) || "GIPHY image", preview: img.url, width: Number(img.width) || 100, height: Number(img.height) || 100 }];
    });
    return { results };
  } catch {
    return { results: [], error: "GIPHY is not responding right now. Try again soon." };
  }
}

async function insertWidget(spaceId: string, kind: "gif" | "image" | "text" | "sticky", data: GifData | ImageData | TextData | StickyData): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  if (!UUID.test(spaceId)) return { error: "That space could not be found." };
  const { count, error: cErr } = await supabase.from("space_widgets").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("space_id", spaceId);
  if (cErr) return { error: nice(cErr.message, "Could not add the widget.") };
  if ((count ?? 0) >= MAX_WIDGETS_PER_SPACE) return { error: `You can add up to ${MAX_WIDGETS_PER_SPACE} custom widgets per space. Remove one first.` };
  const { error } = await supabase.from("space_widgets").insert({ user_id: user.id, space_id: spaceId, kind, data });
  if (error) return { error: nice(error.message, "Could not add the widget.") };
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}

// The GIF is looked up again on the server so only real, G-rated GIPHY media is ever stored.
export async function addGifWidget(spaceId: string, giphyId: string, sticker: boolean): Promise<{ error?: string }> {
  try { await authed(); } catch { return { error: "Please sign in again." }; }
  const key = process.env.GIPHY_API_KEY;
  if (!key) return { error: "GIF search isn't set up yet." };
  if (!/^[A-Za-z0-9]{3,40}$/.test(giphyId)) return { error: "That GIF could not be found." };
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/${giphyId}?api_key=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: "That GIF could not be found." };
    const g = ((await res.json()) as { data?: GiphyItem }).data;
    const img = g?.images?.fixed_height ?? g?.images?.original;
    const still = g?.images?.fixed_height_still ?? g?.images?.original_still;
    if (!g || !img?.url || !still?.url || !giphyHost(img.url) || !giphyHost(still.url)) return { error: "That GIF could not be found." };
    if (g.rating && g.rating !== "g") return { error: "Only G-rated GIFs can be added." };
    return insertWidget(spaceId, "gif", {
      giphyId: g.id, title: clean(g.title, 120) || "GIPHY image", url: img.url, still: still.url,
      width: Number(img.width) || 200, height: Number(img.height) || 200, sticker: !!sticker,
    });
  } catch {
    return { error: "GIPHY is not responding right now. Try again soon." };
  }
}

export async function addUploadedImage(spaceId: string, path: string, alt: string, caption: string): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  const { supabase, user } = ctx;
  if (!UUID.test(spaceId) || typeof path !== "string" || !path.startsWith(`${user.id}/${spaceId}/`) || path.includes("..")) return { error: "That upload could not be used." };
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!["jpg", "png", "webp", "gif"].includes(ext)) return { error: "Only JPG, PNG, WebP or GIF images can be added." };
  const { data, error } = await supabase.storage.from(WIDGET_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return { error: nice(error?.message ?? "", "That upload could not be found. Try again.") };
  return insertWidget(spaceId, "image", { source: "upload", path, alt: clean(alt, 200), caption: clean(caption, 160), animated: ext === "gif" });
}

// ---- Personal saved-sticker library (migration 27). Files: <user id>/library/<uuid>.png in the private bucket. ----
const MAX_SAVED_STICKERS = 100;
const LIB_MISSING = "Saved stickers need a database update. Run supabase/migration-27-saved-stickers.sql.";
const libNice = (m: string, fallback: string) => (/schema cache|does not exist|could not find the table/i.test(m) ? LIB_MISSING : fallback);
export type SavedSticker = { id: string; alt: string; width: number; height: number; url: string };

export async function saveStickerToLibrary(path: string, alt: string, width: number, height: number): Promise<{ id?: string; error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  const { supabase, user } = ctx;
  if (typeof path !== "string" || !path.startsWith(`${user.id}/library/`) || path.includes("..") || !path.endsWith(".png")) return { error: "That sticker could not be saved." };
  const { count, error: cErr } = await supabase.from("saved_stickers").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if (cErr) return { error: libNice(cErr.message, "Could not save the sticker.") };
  if ((count ?? 0) >= MAX_SAVED_STICKERS) return { error: `Your saved stickers are full (${MAX_SAVED_STICKERS}). Delete some in the Saved tab, then try again.` };
  const { data, error } = await supabase.from("saved_stickers").insert({ user_id: user.id, path, alt: clean(alt, 200), width: Math.max(0, Math.min(4096, Math.round(Number(width) || 0))), height: Math.max(0, Math.min(4096, Math.round(Number(height) || 0))) }).select("id").single();
  if (error || !data) return { error: libNice(error?.message ?? "", "Could not save the sticker.") };
  return { id: data.id as string };
}

export async function listSavedStickers(): Promise<{ items: SavedSticker[]; error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { items: [], error: "Please sign in again." }; }
  const { supabase, user } = ctx;
  const { data, error } = await supabase.from("saved_stickers").select("id, path, alt, width, height").eq("user_id", user.id).order("created_at", { ascending: false }).limit(MAX_SAVED_STICKERS);
  if (error) return { items: [], error: libNice(error.message, "Could not load your saved stickers.") };
  const rows = data ?? [];
  if (!rows.length) return { items: [] };
  const { data: signed } = await supabase.storage.from(WIDGET_BUCKET).createSignedUrls(rows.map((r) => r.path as string), 3600);
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const items = rows.flatMap((r) => { const url = byPath.get(r.path as string); return url ? [{ id: r.id as string, alt: r.alt as string, width: r.width as number, height: r.height as number, url }] : []; });
  return { items };
}

// Places a copy of the saved file in this space's own folder, so deleting it from the library never breaks the placed sticker.
export async function placeSavedSticker(spaceId: string, savedId: string): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  const { supabase, user } = ctx;
  if (!UUID.test(spaceId) || !UUID.test(savedId)) return { error: "That sticker could not be found." };
  const { data: row, error } = await supabase.from("saved_stickers").select("path, alt").eq("id", savedId).eq("user_id", user.id).maybeSingle();
  if (error) return { error: libNice(error.message, "Could not place the sticker.") };
  if (!row) return { error: "That sticker could not be found." };
  const dest = `${user.id}/${spaceId}/${crypto.randomUUID()}.png`;
  const cp = await supabase.storage.from(WIDGET_BUCKET).copy(row.path as string, dest);
  if (cp.error) return { error: "That sticker could not be placed. Try again." };
  await supabase.rpc("inherit_media_review", { p_bucket: WIDGET_BUCKET, p_src: row.path as string, p_dest: dest }); // stays hidden if the saved sticker is not cleared
  const r = await insertWidget(spaceId, "image", { source: "upload", path: dest, alt: clean(row.alt, 200), caption: "", animated: false });
  if (r.error) await supabase.storage.from(WIDGET_BUCKET).remove([dest]);
  return r;
}

export async function deleteSavedSticker(savedId: string): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  const { supabase, user } = ctx;
  if (!UUID.test(savedId)) return { error: "That sticker could not be found." };
  const { data: row } = await supabase.from("saved_stickers").select("path").eq("id", savedId).eq("user_id", user.id).maybeSingle();
  const { error } = await supabase.from("saved_stickers").delete().eq("id", savedId).eq("user_id", user.id);
  if (error) return { error: libNice(error.message, "Could not delete the sticker.") };
  if (row?.path && (row.path as string).startsWith(`${user.id}/library/`)) await supabase.storage.from(WIDGET_BUCKET).remove([row.path as string]);
  return {};
}

// Block loopback, private and link-local addresses so the link check can't be pointed at internal services.
function privateIp(ip: string) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function checkImageLink(raw: string): Promise<{ url?: string; animated?: boolean; error?: string }> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { error: "That does not look like a link." }; }
  if (u.protocol !== "https:") return { error: "Image links must start with https://" };
  if (u.username || u.password) return { error: "That link is not allowed." };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || isIP(host.replace(/^\[|\]$/g, ""))) return { error: "That link is not allowed." };
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return { error: "That link is not allowed." };
  } catch { return { error: "That address could not be reached." }; }
  const extOk = /\.(jpe?g|png|webp|gif)$/i.test(u.pathname);
  try {
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(6000), headers: { Range: "bytes=0-0", Accept: "image/*" }, cache: "no-store" });
    void res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) return { error: "That link redirects somewhere else. Paste the direct image link." };
    if (!res.ok) return { error: "That image could not be loaded from the link." };
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const total = Number((res.headers.get("content-range") ?? "").split("/")[1]) || Number(res.headers.get("content-length")) || 0;
    if (total > MAX_IMAGE_BYTES) return { error: "That image is larger than 10 MB." };
    const typed = ct in IMAGE_TYPES;
    if (!typed && !(extOk && (ct === "" || ct === "application/octet-stream"))) return { error: "That link is not a JPG, PNG, WebP or GIF image." };
    return { url: u.toString(), animated: typed ? ct === "image/gif" : /\.gif$/i.test(u.pathname) };
  } catch { return { error: "That image could not be loaded from the link." }; }
}

export async function addImageLink(spaceId: string, link: string, alt: string, caption: string): Promise<{ error?: string }> {
  try { await authed(); } catch { return { error: "Please sign in again." }; }
  const checked = await checkImageLink(typeof link === "string" ? link : "");
  if (checked.error || !checked.url) return { error: checked.error ?? "That link is not allowed." };
  if (checked.url.length > 1000) return { error: "That link is too long." };
  return insertWidget(spaceId, "image", { source: "link", url: checked.url, alt: clean(alt, 200), caption: clean(caption, 160), animated: !!checked.animated });
}

export async function removeCustomWidget(spaceId: string, widgetId: string): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  const { supabase, user } = ctx;
  if (!UUID.test(widgetId)) return { error: "That widget could not be found." };
  const { data: row } = await supabase.from("space_widgets").select("kind, data").eq("id", widgetId).eq("user_id", user.id).maybeSingle();
  const { error } = await supabase.from("space_widgets").delete().eq("id", widgetId).eq("user_id", user.id);
  if (error) return { error: nice(error.message, "Could not remove the widget.") };
  const path = row?.kind === "image" ? (row.data as ImageData).path : null;
  if (path && path.startsWith(`${user.id}/`)) await supabase.storage.from(WIDGET_BUCKET).remove([path]);
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}

const cleanText = (v: unknown): TextData => {
  const t = (v ?? {}) as Partial<TextData>;
  return {
    text: typeof t.text === "string" ? t.text.replace(/ /g, "").slice(0, MAX_TEXT) : "",
    size: t.size === "heading" ? "heading" : "body",
    align: t.align === "center" || t.align === "right" ? t.align : "left",
  };
};

export async function addTextWidget(spaceId: string): Promise<{ error?: string }> {
  try { await authed(); } catch { return { error: "Please sign in again." }; }
  return insertWidget(spaceId, "text", { text: "", size: "body", align: "left" });
}

export async function saveTextWidget(widgetId: string, data: TextData): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  if (!UUID.test(widgetId)) return { error: "That widget could not be found." };
  // Keep the sticker position stored alongside the text.
  const { data: row } = await ctx.supabase.from("space_widgets").select("data").eq("id", widgetId).eq("user_id", ctx.user.id).eq("kind", "text").maybeSingle();
  const next = { ...cleanPos(row?.data), ...cleanText(data) };
  if (JSON.stringify(next).length > MAX_WIDGET_BYTES - 200) return { error: "That text is too long to save." };
  const { error } = await ctx.supabase.from("space_widgets").update({ data: next }).eq("id", widgetId).eq("user_id", ctx.user.id).eq("kind", "text");
  return error ? { error: nice(error.message, "Could not save your text.") } : {};
}

// ---- Sticky notes as stickers (migration 28). Per person, like every other custom widget. ----
export async function addStickyNote(spaceId: string, color: string): Promise<{ error?: string }> {
  try { await authed(); } catch { return { error: "Please sign in again." }; }
  const c = STICKY_COLOR_IDS.includes(color) ? color : "yellow";
  // Drop it near the top, slightly staggered so a few new notes do not sit exactly on top of each other.
  return insertWidget(spaceId, "sticky", { text: "", color: c, x: Math.round((0.08 + Math.random() * 0.45) * 1000) / 1000, y: Math.round(16 + Math.random() * 60), w: 200 });
}

export async function saveStickyNote(widgetId: string, patch: { text?: string; color?: string }): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  if (!UUID.test(widgetId)) return { error: "That sticky note could not be found." };
  const { supabase, user } = ctx;
  const { data: row } = await supabase.from("space_widgets").select("data").eq("id", widgetId).eq("user_id", user.id).eq("kind", "sticky").maybeSingle();
  if (!row) return { error: "That sticky note could not be found." };
  const cur = row.data as StickyData;
  const next: StickyData = { ...cur };
  if (typeof patch.text === "string") next.text = patch.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, STICKY_MAX_TEXT);
  if (patch.color && STICKY_COLOR_IDS.includes(patch.color)) next.color = patch.color;
  if (JSON.stringify(next).length > MAX_WIDGET_BYTES - 200) return { error: "That note is too long to save." };
  const { error } = await supabase.from("space_widgets").update({ data: next }).eq("id", widgetId).eq("user_id", user.id).eq("kind", "sticky");
  return error ? { error: nice(error.message, "Could not save the sticky note.") } : {};
}

// Only finite, in-range numbers are ever stored for a sticker's position.
function cleanPos(v: unknown): StickerPos {
  const p = (v ?? {}) as StickerPos;
  const out: StickerPos = {};
  const num = (n: unknown, lo: number, hi: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined);
  const x = num(p.x, 0, 1), y = num(p.y, 0, STICKER_MAX_Y), w = num(p.w, STICKER_MIN_W, STICKER_MAX_W), z = num(p.z, 0, 1_000_000);
  if (x !== undefined) out.x = Math.round(x * 10000) / 10000;
  if (y !== undefined) out.y = Math.round(y);
  if (w !== undefined) out.w = Math.round(w);
  if (z !== undefined) out.z = Math.round(z);
  return out;
}

export async function saveStickerPos(widgetId: string, pos: StickerPos): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  if (!UUID.test(widgetId)) return { error: "That widget could not be found." };
  const { supabase, user } = ctx;
  const { data: row } = await supabase.from("space_widgets").select("kind, data").eq("id", widgetId).eq("user_id", user.id).maybeSingle();
  if (!row || (row.kind !== "image" && row.kind !== "text" && row.kind !== "sticky")) return { error: "That widget could not be found." };
  const next = { ...(row.data as object), ...cleanPos(pos) };
  if (JSON.stringify(next).length > MAX_WIDGET_BYTES - 200) return { error: "That widget is too large to save." };
  const { error } = await supabase.from("space_widgets").update({ data: next }).eq("id", widgetId).eq("user_id", user.id);
  return error ? { error: nice(error.message, "Could not save the position.") } : {};
}

// Colour for any widget on the space home (built-in or custom); null restores the default.
export async function setWidgetColor(spaceId: string, widgetId: string, color: string | null): Promise<{ error?: string }> {
  let ctx; try { ctx = await authed(); } catch { return { error: "Please sign in again." }; }
  const { supabase, user } = ctx;
  if (!UUID.test(spaceId) || !/^[a-z0-9-]{1,48}$/.test(widgetId) || (color !== null && !COLOR_KEYS.includes(color))) return { error: "That colour could not be saved." };
  const { data } = await supabase.from("space_widget_colors").select("colors").eq("user_id", user.id).eq("space_id", spaceId).maybeSingle();
  const next: Record<string, string> = { ...((data?.colors as Record<string, string> | null) ?? {}) };
  if (color) next[widgetId] = color; else delete next[widgetId];
  const { error } = await supabase.from("space_widget_colors").upsert({ user_id: user.id, space_id: spaceId, colors: next, updated_at: new Date().toISOString() });
  return error ? { error: nice(error.message, "Could not save the colour.") } : {};
}
