import JSZip from "jszip";
import mammoth from "mammoth";

// Convert an uploaded file into the note editor's HTML (Tiptap StarterKit schema).
// Formatting is approximated: headings, paragraphs, bold/italic/underline/strike, lists, links, simple tables as rows.

export const EDITABLE_RE = /\.(docx|pptx|txt|md)$/i;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const KEEP = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "u", "s", "code", "pre", "ul", "ol", "li", "blockquote", "br", "hr", "a"]);
const ALIAS: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s", sup: "", sub: "" };
const INLINE_IN_TABLE = new Set(["strong", "em", "u", "s", "code", "a"]);

// Allowlist sanitizer for mammoth output. Unknown tags are dropped (text kept); images are skipped; tables become "a | b" rows.
export function sanitizeToEditorHtml(html: string): string {
  const out: string[] = [];
  let tableDepth = 0;
  const parts = html.split(/(<[^>]*>)/g);
  for (const part of parts) {
    if (!part) continue;
    if (!part.startsWith("<")) { out.push(part); continue; }
    const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(part);
    if (!m) continue;
    const closing = m[1] === "/";
    let name = m[2].toLowerCase();
    if (name in ALIAS) name = ALIAS[name];
    if (name === "table") { tableDepth += closing ? -1 : 1; if (tableDepth < 0) tableDepth = 0; continue; }
    if (tableDepth > 0) {
      if (name === "tr") { out.push(closing ? "</p>" : "<p>"); continue; }
      if (name === "td" || name === "th") { if (closing) out.push(" | "); continue; }
      if (name === "p" || name === "br") { if (closing || name === "br") out.push(" "); continue; }
      if (!INLINE_IN_TABLE.has(name)) continue;
    }
    if (!name || !KEEP.has(name)) continue;
    if (closing) { if (name !== "br" && name !== "hr") out.push(`</${name}>`); continue; }
    if (name === "a") {
      const href = unesc(/href\s*=\s*"([^"]*)"/i.exec(m[3])?.[1] ?? "").trim();
      if (/^(https?:|mailto:)/i.test(href)) out.push(`<a href="${esc(href).replace(/"/g, "&quot;")}" rel="noopener noreferrer nofollow">`);
      else out.push("<a>"); // keeps tag balance; the editor ignores hrefless anchors
      continue;
    }
    out.push(name === "br" || name === "hr" ? `<${name}>` : `<${name}>`);
  }
  return out.join("")
    .replace(/ \| <\/p>/g, "</p>")
    .replace(/<a><\/a>/g, "")
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<(h[1-6])>\s*<\/\1>/g, "")
    .trim();
}

function paragraphsOf(xml: string): string[] {
  return (xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? [])
    .map((p) => [...p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((t) => unesc(t[1])).join("").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function pptxToHtml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const num = (p: string) => parseInt(p.match(/(\d+)\.xml$/)![1], 10);
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
  let html = "";
  for (const [i, path] of slides.entries()) {
    const xml = await zip.files[path].async("text");
    let title = ""; const body: string[] = [];
    for (const sp of xml.match(/<p:sp[ >][\s\S]*?<\/p:sp>/g) ?? []) {
      const paras = paragraphsOf(sp);
      if (!paras.length) continue;
      if (!title && /<p:ph[^>]*type="(title|ctrTitle)"/.test(sp)) title = paras.join(" ");
      else if (/<p:ph[^>]*type="(sldNum|dt|ftr)"/.test(sp)) continue;
      else body.push(...paras);
    }
    const rel = zip.files[path.replace("slides/", "slides/_rels/") + ".rels"];
    let notes: string[] = [];
    const target = rel && /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(await rel.async("text"))?.[1];
    const nf = target && zip.files[`ppt/notesSlides/${target}`];
    if (nf) notes = paragraphsOf(await nf.async("text")).filter((t) => !/^\d+$/.test(t));
    if (!title && !body.length && !notes.length) continue;
    html += `<h2>${esc(title || `Slide ${i + 1}`)}</h2>`;
    if (body.length) html += `<ul>${body.map((b) => `<li><p>${esc(b)}</p></li>`).join("")}</ul>`;
    if (notes.length) html += `<p><em>Speaker notes: ${esc(notes.join(" "))}</em></p>`;
  }
  return html;
}

const inlineMd = (raw: string) => {
  let s = esc(raw);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(?<![*\w])\*([^*\s][^*]*)\*(?!\*)|(?<![_\w])_([^_\s][^_]*)_(?![_\w])/g, (_m, a, b) => `<em>${a ?? b}</em>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t, u) => `<a href="${u.replace(/"/g, "&quot;")}" rel="noopener noreferrer nofollow">${t}</a>`);
  return s;
};

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let html = ""; let para: string[] = []; let list: "ul" | "ol" | null = null; let code: string[] | null = null;
  const flushPara = () => { if (para.length) { html += `<p>${para.map(inlineMd).join("<br>")}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    if (code) { if (/^```/.test(line)) { html += `<pre><code>${esc(code.join("\n"))}</code></pre>`; code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flushPara(); closeList(); code = []; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeList(); html += `<h${h[1].length}>${inlineMd(h[2].trim())}</h${h[1].length}>`; }
    else if (li) {
      flushPara();
      const kind = /\d/.test(li[1]) ? "ol" : "ul";
      if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
      html += `<li><p>${inlineMd(li[2])}</p></li>`;
    } else if (/^>\s?/.test(line)) { flushPara(); closeList(); html += `<blockquote><p>${inlineMd(line.replace(/^>\s?/, ""))}</p></blockquote>`; }
    else if (/^\s*([-*_]\s*){3,}$/.test(line)) { flushPara(); closeList(); html += "<hr>"; }
    else if (!line.trim()) { flushPara(); closeList(); }
    else { closeList(); para.push(line.trim()); }
  }
  if (code) html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
  flushPara(); closeList();
  return html;
}

export function textToHtml(text: string): string {
  return text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export async function fileToNoteHtml(name: string, buf: Buffer): Promise<string> {
  const n = name.toLowerCase();
  let html = "";
  if (n.endsWith(".docx")) {
    const r = await mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
    html = sanitizeToEditorHtml(r.value);
  } else if (n.endsWith(".pptx")) {
    html = await pptxToHtml(buf);
  } else if (n.endsWith(".md")) {
    html = markdownToHtml(buf.toString("utf8"));
  } else if (n.endsWith(".txt")) {
    html = textToHtml(buf.toString("utf8"));
  } else {
    throw new Error("This file type can't be converted into an editable note.");
  }
  if (!html.replace(/<[^>]+>/g, "").trim()) throw new Error("No readable text was found in this file.");
  return html;
}
