import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken, tokenKeyReady } from "./tokenCrypto";
import { diffHunks, normRuns, sigOf, trimTrailing, type Block, type BlockKind, type Run } from "@/lib/gdocBlocks";

// Google Docs sync, server side. Uses the person's own Google token (drive.file scope: only documents they pick
// with the Google Picker, or that Logia creates). No AI is involved. Pictures, tables, headers, footers, comments,
// fonts, sizes, colours and page setup are never read for syncing and never written.

import { DRIVE_FILE_SCOPE } from "@/lib/gdocsScopes";

const DOCS = "https://docs.googleapis.com/v1/documents";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DOC_MIME = "application/vnd.google-apps.document";

export type GdocsErrorKind = "not_configured" | "not_connected" | "reconnect" | "rate" | "busy" | "forbidden" | "not_found" | "api";
export class GdocsError extends Error {
  constructor(public kind: GdocsErrorKind, message: string) { super(message); }
}

export const googleEnv = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID || "",
  secret: process.env.GOOGLE_CLIENT_SECRET || "",
});
/** Server side pieces needed to refresh tokens. */
export const gdocsConfigured = () => { const e = googleEnv(); return !!(e.clientId && e.secret && tokenKeyReady()); };
/** The Picker also needs a browser API key and the Google Cloud project number (the digits before the first dash in the client id). */
export function pickerConfig(): { apiKey: string; appId: string } | null {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "";
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  const appId = clientId.split("-")[0];
  return apiKey && /^\d+$/.test(appId) ? { apiKey, appId } : null;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

export async function storeGoogleRefreshToken(supabase: SupabaseClient, refreshToken: string) {
  const { error } = await supabase.rpc("set_oauth_token", { p_provider: "google", p_enc: encryptToken(refreshToken), p_scope: DRIVE_FILE_SCOPE });
  if (error) throw new GdocsError("api", "Couldn't save the Google connection. Has migration 45 been run?");
}

const cache = new Map<string, { token: string; exp: number }>();

export async function googleAccessToken(supabase: SupabaseClient, userId: string): Promise<string> {
  const { clientId, secret } = googleEnv();
  if (!clientId || !secret || !tokenKeyReady()) throw new GdocsError("not_configured", "Google Docs isn't set up for this app yet.");
  const hit = cache.get(userId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const { data, error } = await supabase.rpc("get_oauth_token", { p_provider: "google" });
  if (error || !data) throw new GdocsError("not_connected", "Connect Google Docs in Settings first.");
  let refresh: string;
  try { refresh = decryptToken(String(data)); } catch { throw new GdocsError("reconnect", "Connect Google Docs again in Settings."); }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !j.access_token) {
    if (j.error === "invalid_grant") {
      await supabase.rpc("delete_oauth_token", { p_provider: "google" });
      throw new GdocsError("reconnect", "Google Docs access ended. Connect it again in Settings.");
    }
    throw new GdocsError("api", "Couldn't reach Google just now. Try again in a moment.");
  }
  if (j.scope && !j.scope.includes(DRIVE_FILE_SCOPE)) throw new GdocsError("reconnect", "Google Docs access wasn't granted. Connect it again in Settings.");
  cache.set(userId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3000) * 1000 });
  return j.access_token;
}

export async function revokeGoogleToken(supabase: SupabaseClient) {
  try {
    const { data } = await supabase.rpc("get_oauth_token", { p_provider: "google" });
    if (data) {
      const t = decryptToken(String(data));
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: t }) });
    }
  } catch { /* best effort */ }
  await supabase.rpc("delete_oauth_token", { p_provider: "google" });
}

// ── HTTP with backoff ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gfetch(token: string, url: string, init: RequestInit = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      cache: "no-store",
    });
    if (res.ok) return res.status === 204 ? {} : await res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Math.min(10_000, ra > 0 ? ra * 1000 : 600 * 2 ** attempt + Math.random() * 300));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    const msg = body.error?.message ?? "";
    if (res.status === 401) throw new GdocsError("reconnect", "Google Docs access ended. Connect it again in Settings.");
    if (res.status === 403) throw new GdocsError("forbidden", "Logia can't open that document. Choose it again with Link to a Google Doc.");
    if (res.status === 404) throw new GdocsError("not_found", "That Google Doc can't be found. It may have been deleted or moved.");
    if (res.status === 429) throw new GdocsError("rate", "Google is asking Logia to slow down. Syncing will retry shortly.");
    if (res.status === 400 && /revision/i.test(msg)) throw new GdocsError("busy", "The document changed while syncing. Trying again.");
    if (res.status >= 500) throw new GdocsError("rate", "Google Docs is busy. Syncing will retry shortly.");
    throw new GdocsError("api", "Google Docs didn't accept that change.");
  }
}

// ── Drive and Docs reads ──────────────────────────────────────────────────────

export type DriveMeta = { id: string; name: string; version: string; modifiedTime: string; trashed: boolean; link: string };

export async function driveMeta(token: string, docId: string): Promise<DriveMeta> {
  const j = (await gfetch(token, `${DRIVE}/${encodeURIComponent(docId)}?fields=id,name,mimeType,version,modifiedTime,trashed,webViewLink&supportsAllDrives=true`)) as
    { id: string; name?: string; mimeType?: string; version?: string; modifiedTime?: string; trashed?: boolean; webViewLink?: string };
  if (j.mimeType !== DOC_MIME) throw new GdocsError("api", "That file isn't a Google Doc.");
  return { id: j.id, name: j.name ?? "Untitled document", version: String(j.version ?? j.modifiedTime ?? ""), modifiedTime: j.modifiedTime ?? "", trashed: !!j.trashed, link: j.webViewLink ?? `https://docs.google.com/document/d/${j.id}/edit` };
}

type TextStyle = { bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; link?: { url?: string } };
type DocPara = {
  elements?: { startIndex?: number; endIndex?: number; textRun?: { content?: string; textStyle?: TextStyle } }[];
  paragraphStyle?: { namedStyleType?: string };
  bullet?: { listId?: string; nestingLevel?: number };
};
type GDoc = {
  documentId?: string; title?: string; revisionId?: string;
  body?: { content?: { startIndex?: number; endIndex?: number; paragraph?: DocPara }[] };
  lists?: Record<string, { listProperties?: { nestingLevels?: { glyphType?: string }[] } }>;
};

export async function getDoc(token: string, docId: string): Promise<GDoc> {
  return (await gfetch(token, `${DOCS}/${encodeURIComponent(docId)}`)) as GDoc;
}

export type DocBlock = Block & { s: number; e: number };
export type DocLayout = { blocks: DocBlock[]; bodyEnd: number; finalEmpty: boolean; finalBulleted: boolean; revisionId?: string };

const HEADING: Record<string, BlockKind> = { TITLE: "h1", HEADING_1: "h1", HEADING_2: "h2", HEADING_3: "h3", HEADING_4: "h3", HEADING_5: "h3", HEADING_6: "h3" };

/** Reads only plain paragraphs. A paragraph holding a picture or other embedded object is skipped whole. */
export function docToBlocks(doc: GDoc): DocLayout {
  const content = doc.body?.content ?? [];
  const blocks: DocBlock[] = [];
  let finalEmpty = true; let finalBulleted = false;
  const bodyEnd = content.length ? content[content.length - 1].endIndex ?? 1 : 1;
  for (const el of content) {
    const p = el.paragraph;
    const isFinal = (el.endIndex ?? 0) === bodyEnd;
    if (!p) { if (isFinal) finalEmpty = false; continue; }
    const els = p.elements ?? [];
    let text = "";
    const runs: Run[] = [];
    for (const e of els) {
      const c = e.textRun?.content;
      if (c === undefined) continue;
      text += c;
      const ts = e.textRun?.textStyle ?? {};
      runs.push({ t: c.replace(/\u000b/g, "\n"), ...(ts.bold ? { b: 1 as const } : {}), ...(ts.italic ? { i: 1 as const } : {}), ...(ts.underline ? { u: 1 as const } : {}), ...(ts.strikethrough ? { s: 1 as const } : {}), ...(ts.link?.url ? { a: ts.link.url } : {}) });
    }
    if (isFinal) { finalEmpty = text.replace(/\n/g, "").length === 0 && els.every((e) => !!e.textRun); finalBulleted = !!p.bullet; }
    if (els.some((e) => !e.textRun)) continue; // picture, footnote, page break, chip: left alone
    // Drop the paragraph's closing newline from the last run.
    const last = runs[runs.length - 1];
    if (last && last.t.endsWith("\n")) last.t = last.t.slice(0, -1);
    let kind: BlockKind = HEADING[p.paragraphStyle?.namedStyleType ?? ""] ?? "p";
    if (p.bullet) {
      const g = doc.lists?.[p.bullet.listId ?? ""]?.listProperties?.nestingLevels?.[p.bullet.nestingLevel ?? 0]?.glyphType;
      kind = g && g !== "GLYPH_TYPE_UNSPECIFIED" && g !== "NONE" ? "ol" : "ul";
    }
    blocks.push({ k: kind, r: normRuns(runs), s: el.startIndex ?? 0, e: el.endIndex ?? 0 });
  }
  return { blocks, bodyEnd, finalEmpty, finalBulleted, revisionId: doc.revisionId };
}

export const stripPos = (bs: DocBlock[]): Block[] => bs.map((b) => ({ k: b.k, r: b.r }));

// ── Logia to Docs: send only the changed blocks ───────────────────────────────

type Req = Record<string, unknown>;
const NAMED: Record<BlockKind, string> = { p: "NORMAL_TEXT", h1: "HEADING_1", h2: "HEADING_2", h3: "HEADING_3", ul: "NORMAL_TEXT", ol: "NORMAL_TEXT" };
const isList = (k: BlockKind) => k === "ul" || k === "ol";
const textOf = (b: Block) => b.r.map((x) => x.t).join("").replace(/\n/g, "\u000b");

type Group = { at: number; reqs: Req[] };

function styleReqs(P0: number, ds: Block[], skipParagraphStyle: boolean, clearBullets: boolean): Req[] {
  const reqs: Req[] = [];
  const lens = ds.map((d) => textOf(d).length + 1);
  const total = lens.reduce((a, b) => a + b, 0);
  // Reset only the marks Logia syncs, so fonts, sizes and colours the doc already has are left as they are.
  reqs.push({ updateTextStyle: { range: { startIndex: P0, endIndex: P0 + total }, textStyle: {}, fields: "bold,italic,underline,strikethrough,link" } });
  let off = P0;
  ds.forEach((d, i) => {
    let ro = off;
    for (const r of d.r) {
      const len = r.t.length; // "\n" and "\u000b" are one unit each
      if (r.b || r.i || r.u || r.s || r.a) {
        const ts: Record<string, unknown> = {}; const f: string[] = [];
        if (r.b) { ts.bold = true; f.push("bold"); }
        if (r.i) { ts.italic = true; f.push("italic"); }
        if (r.u) { ts.underline = true; f.push("underline"); }
        if (r.s) { ts.strikethrough = true; f.push("strikethrough"); }
        if (r.a) { ts.link = { url: r.a }; f.push("link"); }
        reqs.push({ updateTextStyle: { range: { startIndex: ro, endIndex: ro + len }, textStyle: ts, fields: f.join(",") } });
      }
      ro += len;
    }
    off += lens[i];
  });
  if (skipParagraphStyle) return reqs;
  // Paragraph styles in runs of the same style.
  off = P0;
  let i = 0;
  while (i < ds.length) {
    let j = i; let end = off;
    const named = NAMED[ds[i].k];
    while (j < ds.length && NAMED[ds[j].k] === named) { end += lens[j]; j++; }
    reqs.push({ updateParagraphStyle: { range: { startIndex: off, endIndex: end }, paragraphStyle: { namedStyleType: named }, fields: "namedStyleType" } });
    off = end; i = j;
  }
  if (clearBullets) reqs.push({ deleteParagraphBullets: { range: { startIndex: P0, endIndex: P0 + total } } });
  off = P0; i = 0;
  while (i < ds.length) {
    if (!isList(ds[i].k)) { off += lens[i]; i++; continue; }
    let j = i; let end = off;
    while (j < ds.length && ds[j].k === ds[i].k) { end += lens[j]; j++; }
    reqs.push({ createParagraphBullets: { range: { startIndex: off, endIndex: end }, bulletPreset: ds[i].k === "ol" ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE" } });
    off = end; i = j;
  }
  return reqs;
}

/** Builds batchUpdate requests that turn the document's blocks into `desired`, changing only blocks that differ. */
export function buildRequests(layout: DocLayout, desired: Block[]): Req[] {
  const R = trimTrailing(layout.blocks as Block[]) as DocBlock[];
  const D = trimTrailing(desired);
  const hunks = diffHunks(R.map(sigOf), D.map(sigOf));
  const groups: Group[] = [];

  for (const h of hunks) {
    const ds = D.slice(h.b0, h.b1);
    const rs = R.slice(h.a0, h.a1);
    if (!rs.length) {
      // Pure insertion.
      const text = ds.map(textOf).join("\n");
      if (h.a0 < R.length) {
        const at = R[h.a0].s;
        const reqs: Req[] = [{ insertText: { location: { index: at }, text: text + "\n" } }, ...styleReqs(at, ds, false, isList(R[h.a0].k))];
        groups.push({ at, reqs });
      } else {
        const at = layout.bodyEnd - 1;
        if (layout.finalEmpty) groups.push({ at, reqs: [{ insertText: { location: { index: at }, text } }, ...styleReqs(at, ds, false, layout.finalBulleted)] });
        else groups.push({ at, reqs: [{ insertText: { location: { index: at }, text: "\n" + text } }, ...styleReqs(at + 1, ds, false, layout.finalBulleted)] });
      }
      continue;
    }
    // Replace or delete: split into runs of touching paragraphs so anything between them (pictures, tables) is never removed.
    const clusters: DocBlock[][] = [];
    for (const r of rs) {
      const c = clusters[clusters.length - 1];
      if (c && c[c.length - 1].e === r.s) c.push(r); else clusters.push([r]);
    }
    clusters.forEach((cl, ci) => {
      const S = cl[0].s; const E = cl[cl.length - 1].e;
      const mine = ci === 0 ? ds : [];
      const reqs: Req[] = [];
      if (mine.length) {
        if (E - 1 > S) reqs.push({ deleteContentRange: { range: { startIndex: S, endIndex: E - 1 } } });
        const sameKind = cl.length === 1 && mine.length === 1 && cl[0].k === mine[0].k;
        reqs.push({ insertText: { location: { index: S }, text: mine.map(textOf).join("\n") } });
        reqs.push(...styleReqs(S, mine, sameKind, cl.some((b) => isList(b.k))));
      } else if (E === layout.bodyEnd) {
        // The closing paragraph of the document cannot be removed; empty it instead.
        if (E - 1 > S) reqs.push({ deleteContentRange: { range: { startIndex: S, endIndex: E - 1 } } });
        reqs.push({ updateParagraphStyle: { range: { startIndex: S, endIndex: S + 1 }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } });
        if (cl.some((b) => isList(b.k))) reqs.push({ deleteParagraphBullets: { range: { startIndex: S, endIndex: S + 1 } } });
      } else {
        reqs.push({ deleteContentRange: { range: { startIndex: S, endIndex: E } } });
      }
      groups.push({ at: S, reqs });
    });
  }
  // Highest position first, so earlier indexes are still right when their turn comes.
  groups.sort((a, b) => b.at - a.at);
  return groups.flatMap((g) => g.reqs);
}

export async function pushBlocks(token: string, docId: string, desired: Block[]): Promise<boolean> {
  const doc = await getDoc(token, docId);
  const layout = docToBlocks(doc);
  const reqs = buildRequests(layout, desired);
  if (!reqs.length) return false;
  const CHUNK = 1500;
  for (let i = 0; i < reqs.length; i += CHUNK) {
    await gfetch(token, `${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: reqs.slice(i, i + CHUNK), ...(i === 0 && doc.revisionId ? { writeControl: { requiredRevisionId: doc.revisionId } } : {}) }),
    });
  }
  return true;
}

export async function createDoc(token: string, title: string): Promise<{ id: string; link: string }> {
  const j = (await gfetch(token, DOCS, { method: "POST", body: JSON.stringify({ title: title.slice(0, 200) || "Untitled note" }) })) as { documentId: string };
  return { id: j.documentId, link: `https://docs.google.com/document/d/${j.documentId}/edit` };
}
