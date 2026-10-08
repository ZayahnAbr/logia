import JSZip from "jszip";

// Server-side download of a public share link (Google Drive/Docs/Slides/Sheets, OneDrive/SharePoint, Dropbox).
// No API keys: only files shared as "anyone with the link" can be fetched.

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_HOPS = 8;

export class ImportError extends Error {}

// Hosts we will talk to, on the first request and on every redirect hop.
const HOST_SUFFIXES = [
  "drive.google.com", "docs.google.com", "drive.usercontent.google.com", "googleusercontent.com",
  "dropbox.com", "dropboxusercontent.com",
  "1drv.ms", "onedrive.live.com", "api.onedrive.com", "1drv.com", "files.1drv.com", "sharepoint.com",
];
export function hostAllowed(host: string) {
  const h = host.toLowerCase();
  if (!h || h === "localhost" || h.includes(":") || /^\d+(\.\d+){3}$/.test(h) || /^\[/.test(h) || !h.includes(".")) return false; // no IPs, no localhost
  return HOST_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
}

type Plan = { urls: string[]; fallbackName: string; kind: "drive" | "google" | "dropbox" | "onedrive" | "sharepoint" };

const PRIVATE_MSG = "Logia couldn't read that file. It is probably private or needs you to sign in. In the sharing settings, set it to \"Anyone with the link can view\", then try again.";

export function planImport(raw: string): Plan {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new ImportError("That doesn't look like a link. Paste the full address, starting with https://."); }
  if (u.protocol !== "https:") throw new ImportError("Only https links are supported.");
  if (!hostAllowed(u.hostname)) throw new ImportError("That link isn't from a supported site. Use a share link from Google Drive, Google Docs, Slides or Sheets, OneDrive, SharePoint or Dropbox.");
  const h = u.hostname.toLowerCase();
  const p = u.pathname;

  if (h === "docs.google.com") {
    const m = /^\/(document|presentation|spreadsheets)\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(p);
    if (!m) throw new ImportError("That Google link isn't a Doc, Slides or Sheets file. Open the file and copy its share link.");
    const [, kind, id] = m;
    const fmt = kind === "document" ? "docx" : kind === "presentation" ? "pptx" : "xlsx";
    return { urls: [`https://docs.google.com/${kind}/d/${id}/export?format=${fmt}`], fallbackName: `Google ${kind === "document" ? "Doc" : kind === "presentation" ? "Slides" : "Sheet"}.${fmt}`, kind: "google" };
  }
  if (h === "drive.google.com" || h === "drive.usercontent.google.com") {
    if (/\/folders\//.test(p) || /\/drive\/(u\/\d+\/)?folders/.test(p)) throw new ImportError("That is a Drive folder. Share a single file and paste its link instead.");
    const id = /\/file\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(p)?.[1] ?? u.searchParams.get("id");
    if (!id || !/^[\w-]+$/.test(id)) throw new ImportError("Couldn't find the file in that Drive link. Open the file, choose Share, and copy the link.");
    return { urls: [`https://drive.google.com/uc?export=download&id=${id}`], fallbackName: "Google Drive file", kind: "drive" };
  }
  if (h === "dropbox.com" || h.endsWith(".dropbox.com") || h.endsWith(".dropboxusercontent.com") || h === "dropboxusercontent.com") {
    if (/^\/(sh|scl\/fo)\//.test(p)) throw new ImportError("That is a Dropbox folder. Share a single file and paste its link instead.");
    const d = new URL(u.toString());
    d.searchParams.set("dl", "1");
    d.searchParams.delete("raw");
    return { urls: [d.toString()], fallbackName: "Dropbox file", kind: "dropbox" };
  }
  if (h === "1drv.ms" || h === "onedrive.live.com" || h === "1drv.com") {
    const b64 = Buffer.from(u.toString(), "utf8").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const dl = new URL(u.toString());
    if (h !== "1drv.ms") dl.searchParams.set("download", "1");
    const urls = [`https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`];
    if (h !== "1drv.ms") urls.push(dl.toString());
    return { urls, fallbackName: "OneDrive file", kind: "onedrive" };
  }
  if (h.endsWith(".sharepoint.com")) {
    const d = new URL(u.toString());
    d.searchParams.set("download", "1");
    return { urls: [d.toString()], fallbackName: "SharePoint file", kind: "sharepoint" };
  }
  throw new ImportError("That link isn't from a supported site. Use a share link from Google Drive, Google Docs, Slides or Sheets, OneDrive, SharePoint or Dropbox.");
}

type Fetched = { buffer: Buffer; name: string | null; contentType: string };

// GET with manual redirects; every hop must be https on an allowlisted host.
async function safeGet(startUrl: string, signal: AbortSignal, cookies: Map<string, string>): Promise<{ res: Response; url: string }> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || (u.port && u.port !== "443") || !hostAllowed(u.hostname)) {
      throw new ImportError("The link redirected somewhere Logia can't safely follow, which usually means it is private or asks you to sign in. " + PRIVATE_MSG);
    }
    const res = await fetch(url, {
      redirect: "manual", signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; LogiaImport/1.0)", accept: "*/*", ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";"); const i = pair.indexOf("=");
      if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new ImportError(PRIVATE_MSG);
      await res.body?.cancel();
      url = new URL(loc, url).toString();
      continue;
    }
    return { res, url };
  }
  throw new ImportError("The link redirected too many times. " + PRIVATE_MSG);
}

async function readCapped(res: Response): Promise<Buffer> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_IMPORT_BYTES) throw new ImportError(`That file is over the 25 MB limit (${(len / 1_000_000).toFixed(1)} MB). Choose a smaller file.`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMPORT_BYTES) { await reader.cancel(); throw new ImportError("That file is over the 25 MB limit. Choose a smaller file."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function dispositionName(h: string | null): string | null {
  if (!h) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(h)?.[1];
  if (star) { try { return decodeURIComponent(star.trim()); } catch { /* fall through */ } }
  const q = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(h)?.[1] ?? /filename\s*=\s*([^;]+)/i.exec(h)?.[1];
  return q ? q.trim() : null;
}

const looksHtml = (b: Buffer, ct: string) => /text\/html|application\/xhtml/i.test(ct) || /^\s*(<!doctype html|<html|<head|<body)/i.test(b.subarray(0, 512).toString("utf8"));

// Google shows an HTML "can't scan for viruses" page for big files; its form carries the confirm token.
function driveConfirmUrl(html: string): string | null {
  const form = /<form[^>]+id="download-form"[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form) {
    const id = /[?&]id=([\w-]+)/.exec(html)?.[1];
    const confirm = /confirm=([\w-]+)/.exec(html)?.[1];
    return id && confirm ? `https://drive.google.com/uc?export=download&id=${id}&confirm=${confirm}` : null;
  }
  const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  try {
    const target = new URL(dec(form[1]));
    for (const m of form[2].matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
      const n = /name="([^"]+)"/.exec(m[0])?.[1]; const v = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
      if (n) target.searchParams.set(n, dec(v));
    }
    return target.toString();
  } catch { return null; }
}

export async function fetchShared(link: string): Promise<{ buffer: Buffer; name: string; mime: string }> {
  const plan = planImport(link);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let got: Fetched | null = null;
    let lastErr: ImportError | null = null;
    const cookies = new Map<string, string>();
    for (const start of plan.urls) {
      try {
        let { res } = await safeGet(start, ac.signal, cookies);
        let buf: Buffer | null = null;
        if (res.ok) buf = await readCapped(res);
        // Drive large-file confirmation page.
        if (res.ok && buf && plan.kind === "drive" && looksHtml(buf, res.headers.get("content-type") ?? "")) {
          const next = driveConfirmUrl(buf.toString("utf8"));
          if (next) { ({ res } = await safeGet(next, ac.signal, cookies)); buf = res.ok ? await readCapped(res) : null; }
        }
        if (!res.ok || !buf) {
          if (res.status === 404) throw new ImportError("That link wasn't found. Check it is copied in full and the file still exists.");
          throw new ImportError(PRIVATE_MSG);
        }
        const ct = res.headers.get("content-type") ?? "";
        if (looksHtml(buf, ct)) throw new ImportError("That link opens a web page, not the file itself, which usually means it is private or needs a sign-in. " + PRIVATE_MSG);
        if (buf.length === 0) throw new ImportError("The file was empty.");
        got = { buffer: buf, name: dispositionName(res.headers.get("content-disposition")), contentType: ct };
        break;
      } catch (e) {
        if (e instanceof ImportError) { lastErr = e; continue; }
        throw e;
      }
    }
    if (!got) throw lastErr ?? new ImportError(PRIVATE_MSG);

    const type = await sniff(got.buffer);
    let name = (got.name ?? plan.fallbackName).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 150) || "Imported file";
    if (type.ext && !new RegExp(`\\.${type.ext}$`, "i").test(name)) {
      // Fix a missing or wrong extension (e.g. Drive exports without one) based on what the bytes really are.
      name = name.replace(/\.(pdf|docx|pptx|xlsx|zip|png|jpe?g|gif|webp)$/i, "") + "." + type.ext;
    }
    return { buffer: got.buffer, name, mime: type.mime || got.contentType.split(";")[0] || "application/octet-stream" };
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if ((e as Error)?.name === "AbortError") throw new ImportError("The download took longer than 30 seconds, so Logia stopped. Try a smaller file.");
    throw new ImportError("Couldn't download that link. Check it and try again.");
  } finally { clearTimeout(timer); }
}

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
async function sniff(b: Buffer): Promise<{ ext: string; mime: string }> {
  if (b.subarray(0, 4).toString("latin1") === "%PDF") return { ext: "pdf", mime: MIME.pdf };
  if (b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG") return { ext: "png", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: "jpg", mime: "image/jpeg" };
  if (b.subarray(0, 3).toString("latin1") === "GIF") return { ext: "gif", mime: "image/gif" };
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    try {
      const zip = await JSZip.loadAsync(b);
      if (zip.files["word/document.xml"]) return { ext: "docx", mime: MIME.docx };
      if (zip.files["ppt/presentation.xml"]) return { ext: "pptx", mime: MIME.pptx };
      if (zip.files["xl/workbook.xml"]) return { ext: "xlsx", mime: MIME.xlsx };
    } catch { /* plain zip */ }
    return { ext: "zip", mime: "application/zip" };
  }
  return { ext: "", mime: "" };
}
