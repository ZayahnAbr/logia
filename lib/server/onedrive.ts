import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken, tokenKeyReady } from "./tokenCrypto";

// Microsoft OneDrive (Microsoft Graph). Word import and export, one way each, no live sync.
// Authorization-code flow with PKCE; the refresh token is stored encrypted (see tokenCrypto).

export const MS_SCOPES = "Files.ReadWrite offline_access User.Read";
const GRAPH = "https://graph.microsoft.com/v1.0";
export const LOGIA_FOLDER = "Logia";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_DOCX_BYTES = 4 * 1024 * 1024; // simple upload limit on Graph; larger needs an upload session

export type MsErrorKind = "not_configured" | "not_connected" | "reconnect" | "rate" | "not_found" | "exists" | "api";
export class MsError extends Error {
  kind: MsErrorKind;
  constructor(kind: MsErrorKind, message: string) { super(message); this.kind = kind; }
}

export const msEnv = () => ({
  clientId: process.env.MICROSOFT_CLIENT_ID || "",
  secret: process.env.MICROSOFT_CLIENT_SECRET || "",
  tenant: process.env.MICROSOFT_TENANT || "common",
});
export const msConfigured = () => { const e = msEnv(); return !!(e.clientId && e.secret && tokenKeyReady()); };
const authBase = () => `https://login.microsoftonline.com/${encodeURIComponent(msEnv().tenant)}/oauth2/v2.0`;

export const msRedirectUri = (origin: string) => process.env.MICROSOFT_REDIRECT_URI || `${origin}/api/microsoft/callback`;

// ── PKCE ──────────────────────────────────────────────────────────────────────

export function newPkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(24).toString("base64url") };
}

export function authorizeUrl(origin: string, state: string, challenge: string) {
  const q = new URLSearchParams({
    client_id: msEnv().clientId, response_type: "code", redirect_uri: msRedirectUri(origin), response_mode: "query",
    scope: MS_SCOPES, state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  return `${authBase()}/authorize?${q}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { clientId, secret } = msEnv();
  const res = await fetch(`${authBase()}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: MS_SCOPES, ...params }), cache: "no-store",
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

export async function exchangeCode(origin: string, code: string, verifier: string): Promise<string> {
  const j = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: msRedirectUri(origin), code_verifier: verifier });
  if (!j.refresh_token) throw new MsError("api", "Microsoft didn't pass the access back. Try connecting again.");
  return j.refresh_token;
}

export async function storeMicrosoftRefreshToken(supabase: SupabaseClient, refreshToken: string) {
  const { error } = await supabase.rpc("set_oauth_token", { p_provider: "microsoft", p_enc: encryptToken(refreshToken), p_scope: MS_SCOPES });
  if (error) throw new MsError("api", "Couldn't save the OneDrive connection. Has migration 45 been run?");
}

const cache = new Map<string, { token: string; exp: number }>();

export async function msAccessToken(supabase: SupabaseClient, userId: string): Promise<string> {
  if (!msConfigured()) throw new MsError("not_configured", "OneDrive isn't set up for this app yet.");
  const hit = cache.get(userId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const { data, error } = await supabase.rpc("get_oauth_token", { p_provider: "microsoft" });
  if (error || !data) throw new MsError("not_connected", "Connect OneDrive in Settings first.");
  let refresh: string;
  try { refresh = decryptToken(String(data)); } catch { throw new MsError("reconnect", "Connect OneDrive again in Settings."); }
  const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  if (!j.access_token) {
    if (j.error === "invalid_grant" || j.error === "interaction_required") {
      await supabase.rpc("delete_oauth_token", { p_provider: "microsoft" });
      throw new MsError("reconnect", "OneDrive access ended. Connect it again in Settings.");
    }
    throw new MsError("api", "Couldn't reach Microsoft just now. Try again in a moment.");
  }
  // Microsoft may rotate the refresh token; keep the newest one.
  if (j.refresh_token && j.refresh_token !== refresh) await storeMicrosoftRefreshToken(supabase, j.refresh_token).catch(() => {});
  cache.set(userId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3000) * 1000 });
  return j.access_token;
}

// ── Graph ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(token: string, path: string, init: RequestInit = {}, raw = false): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path.startsWith("http") ? path : GRAPH + path, {
      ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) }, cache: "no-store",
    });
    if (res.ok || raw) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Math.min(10_000, ra > 0 ? ra * 1000 : 600 * 2 ** attempt));
      continue;
    }
    if (res.status === 401) throw new MsError("reconnect", "OneDrive access ended. Connect it again in Settings.");
    if (res.status === 404) throw new MsError("not_found", "That file or folder can't be found in OneDrive.");
    if (res.status === 409) throw new MsError("exists", "A file with that name already exists in OneDrive.");
    if (res.status === 429) throw new MsError("rate", "OneDrive is busy. Try again in a minute.");
    throw new MsError("api", "OneDrive didn't accept that. Try again.");
  }
}

export type DriveFile = { id: string; name: string; size: number; modified: string; webUrl: string };
type Item = { id: string; name: string; size?: number; lastModifiedDateTime?: string; webUrl?: string; file?: unknown; folder?: unknown; parentReference?: { driveId?: string } };

/** Word files in the person's OneDrive, newest first. A search word narrows the list by name. */
export async function listWordFiles(token: string, query: string): Promise<DriveFile[]> {
  const q = query.trim().replace(/'/g, "''").slice(0, 80);
  const url = `/me/drive/root/search(q='${encodeURIComponent(q || ".docx")}')?$select=id,name,size,lastModifiedDateTime,webUrl,file&$top=100`;
  const j = (await (await graph(token, url)).json()) as { value?: Item[] };
  return (j.value ?? [])
    .filter((i) => i.file && /\.docx$/i.test(i.name) && !i.name.startsWith("~$"))
    .sort((a, b) => (b.lastModifiedDateTime ?? "").localeCompare(a.lastModifiedDateTime ?? ""))
    .slice(0, 50)
    .map((i) => ({ id: i.id, name: i.name, size: i.size ?? 0, modified: i.lastModifiedDateTime ?? "", webUrl: i.webUrl ?? "" }));
}

export async function downloadFile(token: string, id: string): Promise<{ buffer: Buffer; name: string }> {
  const meta = (await (await graph(token, `/me/drive/items/${encodeURIComponent(id)}?$select=id,name,size,file`)).json()) as Item;
  if (!meta.file || !/\.docx$/i.test(meta.name)) throw new MsError("api", "That isn't a Word (.docx) file.");
  if ((meta.size ?? 0) > 25 * 1024 * 1024) throw new MsError("api", "That file is over the 25 MB limit.");
  const res = await graph(token, `/me/drive/items/${encodeURIComponent(id)}/content`);
  return { buffer: Buffer.from(await res.arrayBuffer()), name: meta.name };
}

async function ensureFolder(token: string): Promise<void> {
  const r = await graph(token, `/me/drive/root:/${LOGIA_FOLDER}`, {}, true);
  if (r.ok) return;
  if (r.status !== 404) throw new MsError("api", "OneDrive didn't accept that. Try again.");
  const c = await graph(token, "/me/drive/root/children", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: LOGIA_FOLDER, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  }, true);
  if (!c.ok && c.status !== 409) throw new MsError("api", "Couldn't create the Logia folder in OneDrive.");
}

export async function existingFile(token: string, name: string): Promise<DriveFile | null> {
  const r = await graph(token, `/me/drive/root:/${LOGIA_FOLDER}/${encodeURIComponent(name)}?$select=id,name,size,lastModifiedDateTime,webUrl`, {}, true);
  if (r.status === 404) return null;
  if (!r.ok) throw new MsError("api", "OneDrive didn't accept that. Try again.");
  const i = (await r.json()) as Item;
  return { id: i.id, name: i.name, size: i.size ?? 0, modified: i.lastModifiedDateTime ?? "", webUrl: i.webUrl ?? "" };
}

export async function uploadWord(token: string, name: string, data: Buffer, replace: boolean): Promise<DriveFile> {
  if (data.length > MAX_DOCX_BYTES) throw new MsError("api", "This note is too large to save to OneDrive in one go.");
  await ensureFolder(token);
  const res = await graph(token, `/me/drive/root:/${LOGIA_FOLDER}/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=${replace ? "replace" : "fail"}`, {
    method: "PUT", headers: { "Content-Type": DOCX_MIME }, body: new Uint8Array(data),
  });
  const i = (await res.json()) as Item;
  return { id: i.id, name: i.name, size: i.size ?? 0, modified: i.lastModifiedDateTime ?? "", webUrl: i.webUrl ?? "" };
}
