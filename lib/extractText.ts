"use client";
import { loadPdfjs, withTimeout } from "@/lib/pdf/loadPdfjs";

// Extract plain text from PDF, PowerPoint (.pptx, with speaker notes), Word (.docx), TXT or Markdown, in the browser.
export async function extractFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const pdfjsLib = await loadPdfjs();
    const stuck = "Reading that PDF is taking too long on this device. Try a smaller file, or upload it from a computer.";
    const bytes = await file.arrayBuffer();
    let pdf;
    try {
      pdf = await withTimeout(pdfjsLib.getDocument({ data: bytes.slice(0) }).promise, 12_000, stuck);
    } catch (err) {
      // iPhone Safari sometimes can't start the PDF.js worker. Retry with the reader running on the page itself.
      console.warn("PDF worker failed, retrying without it", err);
      // @ts-expect-error no type declarations for the worker bundle
      (globalThis as any).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
      pdf = await withTimeout(pdfjsLib.getDocument({ data: bytes.slice(0) }).promise, 30_000, stuck);
    }
    const parts: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await withTimeout((async () => (await pdf.getPage(p)).getTextContent())(), 20_000, stuck);
      // Rebuild lines from the glyph positions. Joining every item with a space loses the row
      // structure, which makes tables (course outline mark weightings, for example) unreadable.
      const rows = new Map<number, { x: number; s: string }[]>();
      for (const i of content.items as any[]) {
        const s: string = i.str ?? "";
        if (!s.trim()) continue;
        const t = i.transform as number[] | undefined;
        const y = Math.round((t?.[5] ?? 0) / 3) * 3;   // tolerate small baseline differences
        (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: t?.[4] ?? 0, s });
      }
      const lines = [...rows.entries()]
        .sort((a, b) => b[0] - a[0])                   // PDF y grows upwards
        .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      // Safety net: if rebuilding lines lost text (an unusual PDF, rotated text, no transforms),
      // fall back to the plain join so nothing is worse off than before.
      const flat = (content.items as any[]).map((i) => i.str ?? "").join(" ").replace(/\s+/g, " ").trim();
      const built = lines.join("\n");
      parts.push(built.replace(/\s/g, "").length >= flat.replace(/\s/g, "").length * 0.9 ? built : flat);
    }
    return parts.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  if (name.endsWith(".pptx")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const num = (p: string) => parseInt(p.match(/(\d+)\.xml$/)![1], 10);
    // slides live at ppt/slides/slideN.xml; speaker notes at ppt/notesSlides/notesSlideN.xml
    const slideFiles = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((x, y) => num(x) - num(y));
    // Map each slide to its notes via the slide's relationships file.
    const notesFor = async (slidePath: string) => {
      const rel = zip.files[slidePath.replace("slides/", "slides/_rels/") + ".rels"];
      if (!rel) return "";
      const target = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(await rel.async("text"))?.[1];
      const nf = target && zip.files[`ppt/notesSlides/${target}`];
      return nf ? paragraphs(await nf.async("text"), "a").filter((t) => !/^\d+$/.test(t)).join("\n") : "";
    };

    const slides: string[] = [];
    for (const [i, path] of slideFiles.entries()) {
      const body = paragraphs(await zip.files[path].async("text"), "a").join("\n");
      const notes = await notesFor(path);
      if (body || notes) slides.push([`Slide ${i + 1}`, body, notes && `Notes: ${notes}`].filter(Boolean).join("\n"));
    }
    return slides.join("\n\n").trim();
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return (await file.text()).trim();
  }

  if (name.endsWith(".docx")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const docFile = zip.files["word/document.xml"];
    if (!docFile) return "";
    return docxText(await docFile.async("text"));
  }

  return ""; // unsupported type — indexed as nothing
}

// Word text in document order, keeping table rows on one line as "cell | cell | cell".
// A table row holding an assessment and its weight stays readable this way.
function docxText(xml: string) {
  const lines: string[] = [];
  let line = "";
  let cellDepth = 0;
  const push = () => { const t = line.replace(/\s*\|\s*$/, "").replace(/[ \t]+/g, " ").trim(); if (t) lines.push(t); line = ""; };
  // <w:t> is the only text tag. <w:tab>, <w:tbl>, <w:tc> and <w:tr> all start with "<w:t" too,
  // so the tag name must end at whitespace or ">", or their markup is swallowed as text.
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*>|<w:br\b[^>]*>|<w:tc\b[^>]*>|<\/w:tc>|<\/w:tr>|<\/w:p>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[0];
    if (m[1] !== undefined) line += decodeXml(m[1]);
    else if (tag.startsWith("<w:tab")) line += " ";
    else if (tag.startsWith("<w:br")) push();
    else if (tag.startsWith("<w:tc")) cellDepth++;
    else if (tag === "</w:tc>") { cellDepth = Math.max(0, cellDepth - 1); line += " | "; }
    else if (tag === "</w:tr>") push();
    else if (tag === "</w:p>") { if (cellDepth === 0) push(); else line += " "; }
  }
  push();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Text of each paragraph (<a:p> in PowerPoint), runs joined, empties dropped.
function paragraphs(xml: string, ns: "a" | "w") {
  const pRe = new RegExp(`<${ns}:p(?:\\s[^>]*)?>[\\s\\S]*?<\\/${ns}:p>`, "g");
  const tRe = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${ns}:t>`, "g");
  return (xml.match(pRe) ?? []).map((p) => [...p.matchAll(tRe)].map((m) => decodeXml(m[1])).join("").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function decodeXml(s: string) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Split text into overlapping passages at sentence boundaries.
export function chunkForIndex(text: string, target = 900): string[] {
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]+["”)]?\s*/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > target && cur) { chunks.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim().length > 40) chunks.push(cur.trim());
  return chunks;
}